import os, re
H=os.path.dirname(os.path.abspath(__file__))
K='/home/user/warband/media/brand/video-kit/html/'
def comp(path):
    s=open(path).read()
    return s[s.index('<!-- component:start -->')+24:s.index('<!-- component:end -->')]
def win(cid, title, markup, w, h, s, x, y, crop=None):
    cx, cy, cw, ch = crop or (0, 0, w, h)
    W, Hh = round(cw*s), round(ch*s)
    return (f'<div class="win" id="{cid}" style="left:{x}px;top:{y}px;width:{W}px" data-s="{s}" data-cx="{cx}" data-cy="{cy}">'
            f'<div class="tab"><i class="dot"></i>{title}</div>'
            f'<div class="cv" style="width:{W}px;height:{Hh}px"><div class="cs" style="width:{w}px;height:{h}px;transform:scale({s}) translate({-cx}px,{-cy}px)">{markup}</div></div></div>')
C={n:comp(K+n+'.html') for n in ['monitor','killchain','welcome','chat-learning','terminal','configure']}
C['chat-agent']=comp(H+'/snap/chat-agent.html')
L=lambda t,cls,txt,extra='': f'<div class="cl {cls}" data-t="{t}"{extra}>{txt}</div>'
scenes=[]
# S1 cold open
scenes.append(('s1',0,6,f'''
<div class="cap left" style="top:250px">{L(0.5,'big','Eight legs.')}{L(2.5,'big','One brain.')}{L(4.5,'big r','One target.')}</div>
<div id="hero-slot" class="spslot" style="left:1030px;top:150px;width:621px;height:780px"></div>
<div id="brainglow" class="glow" style="left:1340px;top:527px"></div>'''))
# S2 reveal
scenes.append(('s2',6,8,f'''
<div class="lock" style="top:300px"><div id="lock-slot" class="spslot" style="width:340px;height:427px"></div>
<div><div class="wm slam" data-t="6.0"><b>RED</b>WIDOW</div><div class="mono scr" data-t="6.55" data-d="0.6">Offensive AI · inside VS Code</div></div></div>'''))
# S3 agent chat
scenes.append(('s3',8,14.5,f'''
{win('w-chat','RedWidow: Chat',C['chat-agent'],980,640,1.2,700,139)}
<div class="cap left" style="top:300px;width:560px">
<div class="grp" data-t="8.0" data-x="9.6">{L(8.0,'mid','Tell it')}{L(8.15,'mid r','the target.')}</div>
<div class="grp" data-t="9.6" data-x="10.5">{L(9.6,'big r','Full auto.')}{L(9.75,'mono','ROE · Automatic')}</div>
<div class="grp" data-t="10.5" data-x="12.6">{L(10.5,'mid','It runs')}{L(10.6,'mid r','your tools.')}
<div class="tools">{L(10.6,'mono','▸ nmap')}{L(11.1,'mono','▸ whatweb')}{L(11.6,'mono','▸ ffuf')}{L(12.1,'mono','▸ sqlmap')}</div></div>
<div class="grp" data-t="12.6">{L(12.6,'mid','It finds')}{L(12.75,'mid r','the way in.')}</div>
</div>'''))
# S4 monitor
scenes.append(('s4',14.5,18,f'''
<div class="cap" style="left:110px;top:70px">{L(14.5,'mid inl','Every command.')}{L(15.0,'mid inl r','Live.')}</div>
{win('w-mon','Monitor · kali-1',C['monitor'],981,340,1.75,101,300)}
<div class="mono scr" data-t="16.0" data-d="0.5" style="position:absolute;left:110px;top:970px">In your Docker Kali and Exegol containers</div>'''))
# S5 kill chain
scenes.append(('s5',18,25,f'''
<div class="cap" style="left:110px;top:90px;width:1700px">
<div class="grp" data-t="18.0" data-x="22.9">{L(18.0,'mid inl','It maps')}{L(18.15,'mid inl r','the kill chain.')}</div>
<div class="grp" data-t="22.9">{L(22.9,'mid inl','From scan')}{L(23.05,'mid inl r','to root.')}</div></div>
{win('w-kc','Kill chain',C['killchain'],981,450,2.2,124,300,(0,120,760,240))}
<div class="mono scr" data-t="20.8" data-d="0.6" style="position:absolute;left:124px;top:900px">MITRE ATT&amp;CK · mapped by the agent</div>'''))
# S6 learning
scenes.append(('s6a',25,26,f'''<div class="cap center" style="top:430px">{L(25.0,'huge','Stuck on a box?')}</div>'''))
scenes.append(('s6b',26,28.5,f'''
{win('w-wel','RedWidow: Chat',C['welcome'],470,690,3.0,110,130,(85,60,300,246))}
<div class="cap left" style="left:1080px;top:330px;width:800px">{L(26.0,'mono','Learning mode')}{L(26.6,'mid','It reads')}{L(26.95,'mid','your terminal.')}{L(27.5,'mid r','your course.')}</div>'''))
scenes.append(('s6c',28.5,33,f'''
{win('w-term','kali-1',C['terminal'],560,690,1.1,70,143)}
{win('w-learn','RedWidow: Chat',C['chat-learning'],470,690,1.1,736,143)}
<svg id="link" class="link" width="1920" height="1080"><path id="link-path" d=""/></svg>
<div class="cap left" style="left:1330px;top:330px;width:560px">
<div class="grp" data-t="28.5" data-x="31.0">{L(28.6,'mid','It points')}{L(28.75,'mid','to the')}{L(28.9,'mid r','flaw.')}</div>
<div class="grp" data-t="31.0">{L(31.0,'mid','Stuck?')}{L(31.2,'mid r','Not for')}{L(31.35,'mid r','long.')}</div></div>'''))
# S7 power
scenes.append(('s7a',33,34.5,f'''
{win('w-cfg','Configure',C['configure'],340,301,3.4,382,400,(0,91,340,80))}
<div class="cap left" style="top:120px;width:1700px">{L(33.0,'mid inl','Crank')}{L(33.15,'mid inl r','the brain.')}{L(33.6,'mono','Reasoning effort · Maximum')}</div>'''))
scenes.append(('s7b',34.5,36,f'''
<div class="cap center" style="top:300px">{L(34.5,'mono','Bring your model')}
<div class="swap" style="height:240px">{L(34.6,'huge one','Claude.',' data-x="35.1"')}{L(35.1,'huge one','GPT.',' data-x="35.6"')}{L(35.6,'huge one r','Ollama.')}</div></div>'''))
# S8 end
scenes.append(('s8',36,39,f'''<div class="cap left" style="top:250px">{L(36.0,'big','All of this.')}{L(37.0,'big','Open source.')}{L(38.0,'giant r','Free.')}</div>'''))
scenes.append(('s9',39,42.5,f'''
<div class="lock end" style="top:250px"><div id="end-slot" class="spslot" style="width:300px;height:377px"></div>
<div><div class="wm slam" data-t="39.0"><b>RED</b>WIDOW</div><div class="mono scr" data-t="39.5" data-d="0.6">github.com/tomtimlt/warband</div></div></div>
<div class="legal cl" data-t="39.8">For authorized testing only.</div>'''))
body=''.join(f'<section class="scene" id="{i}" data-in="{a}" data-out="{b}">{h}</section>' for i,a,b,h in scenes)
html=f'''<!doctype html><html><head><meta charset="utf-8"><title>RedWidow promo</title>
<link rel="stylesheet" href="file://{K}css/redwidow-ui.css">
<link rel="stylesheet" href="file://{H}/film.css">
<script src="file:///home/user/warband/media/spider.js"></script>
</head><body><div id="stage">{body}</div><div id="flash"></div><script src="file://{H}/film.js"></script></body></html>'''
open(H+'/film.html','w').write(html)
print(len(html))
