const vscode = require('vscode');

exports.activate = async function activate(context) {
  const {chatHtml,graphHtml,studioHtml,makeNonce,PALETTES} = await import('./src/views.mjs');
  const {createDemo,SCENARIOS} = await import('./src/demo.mjs');
  const media = vscode.Uri.joinPath(context.extensionUri,'media');
  const mounted = new Set();
  const panels = new Map();
  const demo = createDemo({onChange:()=>{for(const record of mounted)redraw(record);},onOpen:(kind,page)=>open(kind,page),onInfo:text=>vscode.window.showInformationMessage(text)});
  const palette=()=>vscode.workspace?.getConfiguration?.('warbandDesign').get('palette','sentinelle');
  function render(record) {
    const {webview,kind}=record;
    const uri=name=>webview.asWebviewUri(vscode.Uri.joinPath(media,name)).toString();
    const options={nonce:makeNonce(),cspSource:webview.cspSource,scriptUri:uri(kind==='graph'||kind==='settings'?'studio.js':'chat.js'),uiUri:uri('ui.js'),iconsUri:uri('icons.js'),styleUri:uri('chat.css'),palette:palette()};
    webview.html=(kind==='graph'?graphHtml:kind==='settings'?studioHtml:chatHtml)(options);
  }
  function redraw(record) {
    const {webview,kind,page}=record;
    if(kind==='graph'||kind==='settings')void webview.postMessage(demo.studioView(kind==='graph'?'graph':page));
    else void webview.postMessage({type:'view',view:demo.chatView(),chatId:'demo'});
  }
  function mount(webview,kind,owner,page='project') {
    const record={webview,kind,page};mounted.add(record);
    webview.options={enableScripts:true,enableCommandUris:false,localResourceRoots:[media]};
    const listener=webview.onDidReceiveMessage(message=>{
      if(!message||typeof message!=='object')return;
      if(message.type==='open'&&kind==='settings'&&['project','spaces','graph','atlas','system'].includes(message.page)){record.page=message.page;redraw(record);return;}
      if(message.type==='watch'){open('monitor');return;}
      if(message.type==='ready'){
        if(kind==='monitor')void webview.postMessage({type:'role',role:'monitor'});
        redraw(record);for(const item of demo.auxiliary())void webview.postMessage(item);
      }else demo.receive(message,item=>void webview.postMessage(item));
    });
    render(record);
    const dispose=owner.onDidDispose(()=>{mounted.delete(record);listener.dispose();});
    context.subscriptions.push(listener,dispose);
  }
  function open(kind,page='project') {
    const existing=panels.get(kind);
    if(existing){existing.reveal();const record=[...mounted].find(r=>r.webview===existing.webview);if(record){record.page=page;redraw(record);}return;}
    const titles={chat:'Conversation · Démo',graph:'Graphe · Démo',monitor:'Monitor · Démo',settings:'Réglages · Démo'};
    if(!Object.hasOwn(titles,kind))return;
    const panel=vscode.window.createWebviewPanel(`warbandDesign.${kind}`,titles[kind],vscode.ViewColumn.One,{enableScripts:true,enableCommandUris:false,localResourceRoots:[media]});
    panels.set(kind,panel);panel.iconPath=vscode.Uri.joinPath(media,'logo-small.svg');
    mount(panel.webview,kind,panel,page);panel.onDidDispose(()=>panels.delete(kind));
  }
  context.subscriptions.push(vscode.window.registerWebviewViewProvider('warbandDesign.chat',{resolveWebviewView:view=>mount(view.webview,'chat',view)}));
  for(const kind of ['chat','graph','monitor','settings'])context.subscriptions.push(vscode.commands.registerCommand(`warbandDesign.${kind}`,()=>open(kind)));
  context.subscriptions.push(vscode.commands.registerCommand('warbandDesign.scenario',async()=>{
    const selected=await vscode.window.showQuickPick(SCENARIOS.map(([value,label])=>({label,value})),{title:'Scénario de démonstration'});
    if(selected)demo.selectScenario(selected.value);
  }));
  context.subscriptions.push(vscode.commands.registerCommand('warbandDesign.palette',async()=>{
    const selected=await vscode.window.showQuickPick(PALETTES.map(([value,label,detail])=>({label,detail,value})),{title:'Palette Warband'});
    if(selected)await vscode.workspace.getConfiguration('warbandDesign').update('palette',selected.value,vscode.ConfigurationTarget.Global);
  }));
  if(vscode.workspace?.onDidChangeConfiguration)context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event=>{
    if(event.affectsConfiguration('warbandDesign.palette'))for(const record of mounted)render(record);
  }));
  context.subscriptions.push({dispose:()=>{demo.dispose();for(const panel of panels.values())panel.dispose();mounted.clear();panels.clear();}});
};
