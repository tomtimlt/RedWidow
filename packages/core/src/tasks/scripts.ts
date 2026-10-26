/** Scripts fixes exécutés uniquement dans un conteneur Linux autorisé. */
const COMMON = String.raw`
import os, sys, json, time, uuid, stat, signal, subprocess, fcntl
WORKSPACE = "/workspace"
REGISTRY = "/tmp/warband-long-tasks-v1"
DIRECTORY = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
LIMIT = 32 * 1024 * 1024

def directory(path, parent=None, create=False, private=False, shared=False):
    created = False
    if create:
        try:
            os.mkdir(path, 0o755 if shared else 0o700, dir_fd=parent)
            created = True
        except FileExistsError: pass
    fd = os.open(path, DIRECTORY, dir_fd=parent)
    if created and shared and parent is not None and os.geteuid() == 0:
        owner = os.fstat(parent)
        os.fchown(fd, owner.st_uid, owner.st_gid)
    if private:
        st = os.fstat(fd)
        if st.st_uid != os.getuid() or st.st_mode & 0o077:
            os.close(fd)
            raise ValueError("task.privateDirectory")
    return fd

def read(fd, name):
    f = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
    try:
        if not stat.S_ISREG(os.fstat(f).st_mode): raise ValueError("task.notRegular")
        with os.fdopen(f, "r", closefd=False) as stream:
            text = stream.read(65537)
        if len(text) > 65536: raise ValueError("task.metadataLimit")
        return json.loads(text)
    finally: os.close(f)

def write(fd, name, value, shared=False):
    tmp = uuid.uuid4().hex + ".tmp"
    f = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644 if shared else 0o600, dir_fd=fd)
    if shared and os.geteuid() == 0:
        owner = os.fstat(fd)
        os.fchown(f, owner.st_uid, owner.st_gid)
    with os.fdopen(f, "w") as stream: json.dump(value, stream)
    os.replace(tmp, name, src_dir_fd=fd, dst_dir_fd=fd)

def identity(pid):
    try:
        with open("/proc/%d/stat" % pid) as stream: fields = stream.read().rsplit(")", 1)[1].split()
        if fields[0] == "Z": return None
        with open("/proc/sys/kernel/random/boot_id") as stream: boot = stream.read().strip()
        return boot + ":" + fields[19]
    except (OSError, ValueError, IndexError): return None

def outputs(task_id, create=False):
    workspace = directory(WORKSPACE)
    try: root = directory("outputs", workspace, create=create, shared=True)
    finally: os.close(workspace)
    try: return directory("warband-task-" + task_id, root, create=create, shared=True)
    finally: os.close(root)

def state(fd):
    value = read(fd, "state.json")
    if value["status"] in ("starting", "running"):
        pid = value.get("supervisor_pid")
        alive = pid and identity(pid) == value.get("supervisor_identity")
        if not alive and (pid or time.time() - value["started_at"] > 5):
            value = dict(value, status="interrupted", exit_code=None)
    return value

def public(value):
    keys = ("task_id", "program", "status", "started_at", "finished_at", "exit_code", "timeout_seconds", "stdout_bytes", "stderr_bytes")
    result = {key: value[key] for key in keys if key in value}
    result["output_directory"] = WORKSPACE + "/outputs/warband-task-" + value["task_id"]
    return result
`;

export const TASK_SUPERVISOR_SCRIPT =
  COMMON +
  String.raw`
import selectors
fd = int(sys.argv[1])
request = read(fd, "request.json")
out = outputs(request["task_id"])
value = read(fd, "state.json")
value.update(supervisor_pid=os.getpid(), supervisor_identity=identity(os.getpid()))
write(fd, "state.json", value)
process = None
reason = None
stop_at = None
streams = {}
counts = {"stdout": 0, "stderr": 0}
selector = selectors.DefaultSelector()

def interrupted(_sig, _frame):
    global reason
    reason = "interrupted"

signal.signal(signal.SIGTERM, interrupted)
signal.signal(signal.SIGINT, interrupted)

def kill_group(sig):
    if process is not None:
        try: os.killpg(process.pid, sig)
        except ProcessLookupError: pass

try:
    for name in counts:
        streams[name] = os.open(name + ".txt", os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644, dir_fd=out)
        if os.geteuid() == 0:
            owner = os.fstat(out)
            os.fchown(streams[name], owner.st_uid, owner.st_gid)
    process = subprocess.Popen(request["argv"], cwd=WORKSPACE, stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True, close_fds=True)
    value["status"] = "running"
    write(fd, "state.json", value)
    selector.register(process.stdout, selectors.EVENT_READ, "stdout")
    selector.register(process.stderr, selectors.EVENT_READ, "stderr")
    deadline = time.monotonic() + request["timeout_seconds"]
    while True:
        if reason is None:
            if os.path.exists("/proc/self/fd/%d/cancel" % fd): reason = "cancelled"
            elif time.monotonic() >= deadline: reason = "timed_out"
        ended = process.poll() is not None
        if (reason is not None or ended) and stop_at is None:
            kill_group(signal.SIGTERM)
            stop_at = time.monotonic() + 3
        if stop_at is not None and time.monotonic() >= stop_at:
            kill_group(signal.SIGKILL)
        for key, _mask in selector.select(0.1):
            chunk = os.read(key.fileobj.fileno(), 65536)
            if not chunk:
                selector.unregister(key.fileobj)
                key.fileobj.close()
                continue
            remaining = LIMIT - sum(counts.values())
            kept = chunk[:max(0, remaining)]
            if kept:
                os.write(streams[key.data], kept)
                counts[key.data] += len(kept)
            if len(chunk) > remaining and reason is None: reason = "output_limit"
        if ended and not selector.get_map(): break
        if stop_at is not None and time.monotonic() > stop_at + 1:
            break
    kill_group(signal.SIGKILL)
    code = process.wait(timeout=2)
    value.update(status=reason or ("completed" if code == 0 else "failed"), exit_code=code)
except Exception as error:
    kill_group(signal.SIGKILL)
    if process is not None:
        try: process.wait(timeout=2)
        except subprocess.TimeoutExpired: pass
    if "stderr" in streams:
        message = (type(error).__name__ + ": " + str(error)[:4096] + "\n").encode()
        kept = message[:max(0, LIMIT - sum(counts.values()))]
        os.write(streams["stderr"], kept)
        counts["stderr"] += len(kept)
    value.update(status="failed", exit_code=None, error_type=type(error).__name__)
finally:
    selector.close()
    for handle in streams.values(): os.close(handle)
    value.update(finished_at=time.time(), stdout_bytes=counts["stdout"], stderr_bytes=counts["stderr"])
    write(fd, "state.json", value)
    write(out, "result.json", public(value), shared=True)
    os.close(out)
    os.close(fd)
`;

export const TASK_CLIENT_SCRIPT =
  COMMON +
  String.raw`
request = json.loads(sys.argv[1])
scope = request["scope"]
operation = request["operation"]
if len(scope) != 64 or any(c not in "0123456789abcdef" for c in scope): raise ValueError("task.scope")
root = directory(REGISTRY, create=True, private=True)
try: project = directory(scope, root, create=True, private=True)
finally: os.close(root)

def task(task_id):
    if len(task_id) != 32 or any(c not in "0123456789abcdef" for c in task_id): raise ValueError("task.id")
    return directory(task_id, project, private=True)

def summaries():
    entries = os.listdir(project)
    if len(entries) > 502: raise ValueError("task.registryLimit")
    values = []
    for name in entries:
        if len(name) != 32 or any(c not in "0123456789abcdef" for c in name): continue
        item = task(name)
        try: values.append(state(item))
        finally: os.close(item)
    return values

if operation == "start":
    lock = os.open("launch.lock", os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600, dir_fd=project)
    fcntl.flock(lock, fcntl.LOCK_EX)
    try:
        values = summaries()
        if len(values) >= 500: raise ValueError("task.registryLimit")
        if sum(v["status"] in ("starting", "running") for v in values) >= 8: raise ValueError("task.activeLimit")
        task_id = request["task_id"]
        if len(task_id) != 32 or any(c not in "0123456789abcdef" for c in task_id): raise ValueError("task.id")
        os.mkdir(task_id, 0o700, dir_fd=project)
        item = task(task_id)
        value = dict(task_id=task_id, status="starting", started_at=time.time(), exit_code=None,
            timeout_seconds=request["timeout_seconds"], program=os.path.basename(request["argv"][0])[:80])
        write(item, "request.json", request)
        write(item, "state.json", value)
        try:
            out = outputs(task_id, create=True)
            os.close(out)
            subprocess.Popen([sys.executable, "-c", sys.argv[2], str(item)], pass_fds=(item,),
                stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                start_new_session=True, close_fds=True)
        except Exception:
            value.update(status="failed", finished_at=time.time())
            write(item, "state.json", value)
            raise
        finally: os.close(item)
        print(json.dumps(public(value)))
    finally:
        os.close(lock)
elif operation == "list":
    lock = os.open("launch.lock", os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600, dir_fd=project)
    fcntl.flock(lock, fcntl.LOCK_SH)
    try: values = sorted(summaries(), key=lambda v: v["started_at"], reverse=True)
    finally: os.close(lock)
    print(json.dumps(dict(tasks=[public(v) for v in values[:50]], truncated=len(values) > 50), ensure_ascii=False, indent=2))
else:
    item = task(request["task_id"])
    try:
        value = state(item)
        if operation == "status":
            deadline = time.monotonic() + min(10, max(0, request.get("wait_seconds", 0)))
            while value["status"] in ("starting", "running") and time.monotonic() < deadline:
                time.sleep(min(0.1, max(0, deadline - time.monotonic())))
                value = state(item)
        if operation == "cancel" and value["status"] in ("starting", "running"):
            handle = os.open("cancel", os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600, dir_fd=item)
            os.close(handle)
        result = public(value)
        if operation == "cancel":
            result["cancellation_requested"] = value["status"] in ("starting", "running")
        if operation == "status":
            out = outputs(request["task_id"])
            try:
                for name in ("stdout", "stderr"):
                    try:
                        handle = os.open(name + ".txt", os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=out)
                    except FileNotFoundError:
                        result[name], result[name + "_bytes"], result[name + "_truncated"] = "", 0, False
                        continue
                    try:
                        info = os.fstat(handle)
                        if not stat.S_ISREG(info.st_mode): raise ValueError("task.notRegular")
                        size = info.st_size
                        os.lseek(handle, max(0, size - 8192), os.SEEK_SET)
                        result[name] = os.read(handle, 8192).decode("utf-8", errors="replace")
                        # Une ligne JSON reste sous le plafond du transport Docker,
                        # même si la sortie contient des milliers de contrôles binaires.
                        while len(json.dumps(result[name], ensure_ascii=False)) > 12000:
                            result[name] = result[name][max(1, len(result[name]) // 4):]
                        result[name + "_bytes"] = size
                        result[name + "_truncated"] = size > len(result[name].encode("utf-8"))
                    finally: os.close(handle)
            finally: os.close(out)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    finally: os.close(item)
os.close(project)
`;
