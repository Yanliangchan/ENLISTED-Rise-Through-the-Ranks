import "@fontsource/barlow-condensed/400.css";
import "@fontsource/barlow-condensed/500.css";
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/barlow-condensed/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/700.css";

/** All interface styling. One restrained palette: bone white on smoke, a single amber signal colour. */
const CSS = `
#ui { --bone:#e9e6dc; --dim:rgba(233,230,220,.56); --faint:rgba(233,230,220,.22); --amber:#e2a23a; --red:#d2452f; --ink:rgba(9,11,10,.72);
  font-family:"Barlow Condensed",system-ui,sans-serif; color:var(--bone); user-select:none; -webkit-user-select:none; letter-spacing:.04em; }
#ui * { box-sizing:border-box; }
.mono { font-family:"JetBrains Mono",ui-monospace,monospace; letter-spacing:0; }

/* ---------- HUD ---------- */
.hud { position:absolute; inset:0; opacity:0; transition:opacity .4s; text-shadow:0 1px 2px rgba(0,0,0,.7); }
.hud.on { opacity:1; }
.compass { position:absolute; top:22px; left:50%; width:440px; height:34px; margin-left:-220px; overflow:hidden;
  -webkit-mask-image:linear-gradient(90deg,transparent,#000 22%,#000 78%,transparent); mask-image:linear-gradient(90deg,transparent,#000 22%,#000 78%,transparent); }
.compass .tape { position:absolute; top:0; left:50%; height:100%; will-change:transform; }
.compass .tk { position:absolute; top:0; width:1px; height:7px; background:var(--dim); }
.compass .tk.maj { height:11px; background:var(--bone); }
.compass .lb { position:absolute; top:13px; transform:translateX(-50%); font-size:15px; font-weight:600; color:var(--dim); }
.compass .lb.card { color:var(--bone); font-size:17px; }
.compass-needle { position:absolute; top:14px; left:50%; width:1px; height:14px; background:var(--amber); margin-left:-.5px; }
.compass-obj { position:absolute; top:20px; left:50%; width:0; height:0; border:5px solid transparent; border-bottom:8px solid var(--amber); margin-left:-5px; will-change:transform; }
.bearing { position:absolute; top:60px; left:50%; transform:translateX(-50%); font-size:12px; color:var(--dim); }

.obj { position:absolute; top:26px; left:30px; width:330px; }
.obj .op { font-size:13px; font-weight:600; letter-spacing:.22em; color:var(--amber); }
.obj .ti { font-size:23px; font-weight:600; line-height:1.08; margin-top:4px; text-transform:uppercase; }
.obj .de { font-size:13px; color:var(--dim); margin-top:5px; }
.obj .rule { width:38px; height:2px; background:var(--amber); margin:8px 0 0; }
.obj.flash .ti { animation:objflash 1.1s ease-out; }
@keyframes objflash { 0%{color:var(--amber);transform:translateX(-8px);opacity:0} 30%{opacity:1} 100%{transform:none} }

.status { position:absolute; left:30px; bottom:28px; display:flex; align-items:flex-end; gap:14px; }
.vit { width:210px; }
.vit .row { display:flex; justify-content:space-between; font-size:13px; font-weight:600; letter-spacing:.18em; color:var(--dim); }
.vit .bar { height:5px; margin-top:6px; background:rgba(233,230,220,.16); position:relative; }
.vit .bar i { position:absolute; inset:0; background:var(--bone); transform-origin:left; transition:transform .18s, background .3s; }
.vit.low .bar i { background:var(--red); }
.vit.low .row b { color:var(--red); }
.vit .row b { font-family:"JetBrains Mono",monospace; font-weight:700; color:var(--bone); letter-spacing:0; }
.stance { font-size:12px; font-weight:600; letter-spacing:.2em; color:var(--dim); padding-bottom:1px; }

.wpn { position:absolute; right:30px; bottom:24px; text-align:right; }
.wpn .nm { font-size:14px; font-weight:600; letter-spacing:.2em; color:var(--dim); }
.wpn .am { font-family:"JetBrains Mono",monospace; font-weight:700; font-size:46px; line-height:1; margin-top:2px; }
.wpn .am span { font-size:19px; color:var(--dim); font-weight:400; margin-left:8px; }
.wpn.low .am b { color:var(--amber); } .wpn.empty .am b { color:var(--red); }
.wpn .am b { font-weight:700; }
.wpn .mt { display:flex; gap:14px; justify-content:flex-end; margin-top:7px; font-size:12px; font-weight:600; letter-spacing:.18em; color:var(--dim); }
.wpn .mt em { font-style:normal; color:var(--bone); }
.pips { display:inline-flex; gap:3px; vertical-align:middle; margin-left:6px; }
.pips i { width:7px; height:9px; border-radius:50% 50% 45% 45%; background:var(--bone); } .pips i.off { background:var(--faint); }

.xh { position:absolute; left:50%; top:50%; width:0; height:0; transition:opacity .12s; }
.xh i { position:absolute; background:var(--bone); box-shadow:0 0 0 1px rgba(0,0,0,.35); }
.xh .l,.xh .r { width:8px; height:1.5px; top:-.75px; } .xh .u,.xh .d { width:1.5px; height:8px; left:-.75px; }
.xh .c { width:2px; height:2px; left:-1px; top:-1px; border-radius:50%; }
.hm { position:absolute; left:50%; top:50%; width:26px; height:26px; margin:-13px; opacity:0; transform:rotate(45deg); }
.hm:before,.hm:after { content:""; position:absolute; background:var(--bone); }
.hm:before { left:12px; top:0; width:2px; height:26px; -webkit-mask:linear-gradient(#000 0 30%,transparent 30% 70%,#000 70%); mask:linear-gradient(#000 0 30%,transparent 30% 70%,#000 70%); }
.hm:after { top:12px; left:0; height:2px; width:26px; -webkit-mask:linear-gradient(90deg,#000 0 30%,transparent 30% 70%,#000 70%); mask:linear-gradient(90deg,#000 0 30%,transparent 30% 70%,#000 70%); }
.hm.kill:before,.hm.kill:after { background:var(--red); }
.hm.go { animation:hm .28s ease-out; }
@keyframes hm { 0%{opacity:1;transform:rotate(45deg) scale(1.5)} 100%{opacity:0;transform:rotate(45deg) scale(.9)} }
.dmg { position:absolute; left:50%; top:50%; width:0; height:0; }
.dmg i { position:absolute; left:-70px; top:-150px; width:140px; height:22px; opacity:0; transform-origin:70px 150px;
  background:radial-gradient(ellipse at 50% 100%, rgba(210,69,47,.95), rgba(210,69,47,0) 70%); }

.feed { position:absolute; right:30px; top:26px; text-align:right; font-size:15px; font-weight:500; }
.feed div { margin-bottom:3px; animation:feed 5s forwards; }
.feed div b { color:var(--amber); font-weight:600; margin-left:8px; font-family:"JetBrains Mono",monospace; font-size:12px; }
@keyframes feed { 0%{opacity:0;transform:translateX(10px)} 6%{opacity:1;transform:none} 80%{opacity:1} 100%{opacity:0} }

.sub { position:absolute; left:50%; bottom:118px; transform:translateX(-50%); max-width:620px; text-align:center; font-size:19px; font-weight:500; line-height:1.25; opacity:0; transition:opacity .3s; }
.sub.on { opacity:1; }
.sub b { display:block; font-size:12px; letter-spacing:.24em; color:var(--amber); font-weight:600; margin-bottom:3px; }
.prompt { position:absolute; left:50%; top:60%; transform:translateX(-50%); text-align:center; font-size:16px; font-weight:600; letter-spacing:.14em; opacity:0; transition:opacity .15s; }
.prompt.on { opacity:1; }
.prompt kbd { font-family:"JetBrains Mono",monospace; font-size:13px; border:1px solid var(--bone); padding:1px 7px; margin-right:9px; }
.prompt .pg { width:150px; height:3px; background:var(--faint); margin:9px auto 0; } .prompt .pg i { display:block; height:100%; width:0; background:var(--amber); }
.mk { position:absolute; left:0; top:0; will-change:transform; text-align:center; width:90px; margin-left:-45px; opacity:.92; }
.mk .d { width:9px; height:9px; margin:0 auto; border:1.5px solid var(--amber); transform:rotate(45deg); }
.mk .m { font-family:"JetBrains Mono",monospace; font-size:11px; margin-top:6px; color:var(--bone); }
.banner { position:absolute; left:0; right:0; top:24%; text-align:center; opacity:0; pointer-events:none; }
.banner.go { animation:banner 4.2s ease-out forwards; }
.banner .a { font-size:13px; letter-spacing:.34em; color:var(--amber); font-weight:600; }
.banner .b { font-size:40px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; margin-top:4px; }
@keyframes banner { 0%{opacity:0;letter-spacing:.2em} 10%{opacity:1} 78%{opacity:1} 100%{opacity:0} }
.timer { position:absolute; top:84px; left:50%; transform:translateX(-50%); font-family:"JetBrains Mono",monospace; font-size:22px; font-weight:700; color:var(--amber); opacity:0; }
.timer.on { opacity:1; }
.scope { position:absolute; inset:0; opacity:0; pointer-events:none;
  background:radial-gradient(circle at 50% 50%, transparent 0, transparent 41.4vh, rgba(0,0,0,.6) 42.4vh, #000 44vh, #000 100%);
  box-shadow:inset 0 0 18vh rgba(0,0,0,.45); }
.scope.wide { background:radial-gradient(circle at 50% 50%, transparent 0, transparent 46vh, rgba(0,0,0,.5) 47.5vh, #050505 50vh, #050505 100%); }
.scope.on { opacity:1; }
.scope .ret { position:absolute; left:50%; top:50%; width:84vh; height:84vh; margin:-42vh 0 0 -42vh; }
.scope .zm { position:absolute; left:50%; top:calc(50% + 34vh); transform:translateX(-50%); font-size:12px; color:rgba(233,230,220,.55); letter-spacing:.1em; }
.scope .br { position:absolute; left:50%; top:calc(50% + 46vh); transform:translateX(-50%); text-align:center; font-size:11px; letter-spacing:.24em; color:rgba(233,230,220,.5); }
.scope .br b { display:block; height:2px; width:100%; background:var(--amber); margin:0 auto 6px; max-width:120px; }
.marks { position:absolute; inset:0; }
.em { position:absolute; left:0; top:0; width:0; height:0; margin:-12px 0 0 -8px; display:none; will-change:transform;
  border-left:8px solid transparent; border-right:8px solid transparent; border-top:11px solid #e0442c;
  filter:drop-shadow(0 0 1px #000) drop-shadow(0 0 4px rgba(224,68,44,.7)); }
.ct { position:absolute; top:24px; left:50%; width:3px; height:9px; margin-left:-1.5px; background:#d2452f; display:none; will-change:transform; }
.slots { display:flex; gap:10px; justify-content:flex-end; margin-top:8px; font-size:12px; font-weight:600; letter-spacing:.14em; color:var(--faint); }
.slots span b { font-family:"JetBrains Mono",monospace; font-weight:400; margin-right:5px; }
.slots span.on { color:var(--bone); }
.fade { position:absolute; inset:0; background:#050606; opacity:0; transition:opacity .9s; pointer-events:none; }
.fade.on { opacity:1; }

/* ---------- menus ---------- */
.menu { position:absolute; inset:0; pointer-events:auto; display:none; }
.menu.on { display:block; }
.menu .shade { position:absolute; inset:0; background:linear-gradient(90deg, rgba(6,8,7,.88) 0%, rgba(6,8,7,.62) 34%, rgba(6,8,7,.08) 68%, rgba(6,8,7,.25) 100%); }
.menu.solid .shade { background:rgba(6,8,7,.82); backdrop-filter:blur(5px); }
.menu .col { position:absolute; left:6vw; top:0; bottom:0; width:min(430px,84vw); display:flex; flex-direction:column; justify-content:center; }
.brand .k { font-size:13px; font-weight:600; letter-spacing:.4em; color:var(--amber); }
.brand h1 { margin:6px 0 0; font-size:104px; line-height:.86; font-weight:700; letter-spacing:.02em; }
.brand p { margin:14px 0 0; font-size:17px; color:var(--dim); line-height:1.35; max-width:360px; letter-spacing:.02em; }
.nav { margin-top:38px; display:flex; flex-direction:column; align-items:flex-start; }
.nav button, .btn { all:unset; cursor:pointer; font-family:inherit; font-size:25px; font-weight:600; letter-spacing:.1em; text-transform:uppercase; color:var(--dim); padding:7px 0 7px 0; position:relative; transition:color .12s, padding .12s; }
.nav button small { display:block; font-size:14px; letter-spacing:.05em; font-weight:400; text-transform:none; color:rgba(233,230,220,.42); transition:color .12s; margin-top:-2px; }
.nav button:hover, .nav button:focus-visible { color:var(--bone); padding-left:18px; }
.nav button:hover small { color:var(--dim); }
.nav button:before { content:""; position:absolute; left:0; top:20px; width:0; height:2px; background:var(--amber); transition:width .12s; }
.nav button:hover:before, .nav button:focus-visible:before { width:11px; }
.nav button.pri { color:var(--bone); }
.who { position:absolute; left:6vw; bottom:34px; font-size:14px; color:var(--dim); display:flex; gap:12px; align-items:center; }
.who b { color:var(--bone); font-weight:600; letter-spacing:.1em; }
.who .ins { font-family:"JetBrains Mono",monospace; font-size:12px; font-weight:700; color:#0b0d0c; background:var(--amber); padding:2px 6px; }
.who a { color:var(--dim); cursor:pointer; text-decoration:underline; text-underline-offset:3px; }
.who a:hover { color:var(--bone); }
.ver { position:absolute; right:30px; bottom:30px; font-size:12px; color:var(--faint); letter-spacing:.14em; text-align:right; line-height:1.6; }
.panel { position:absolute; right:6vw; top:50%; transform:translateY(-50%); width:min(520px,88vw); max-height:84vh; overflow:auto; background:rgba(9,11,10,.8); border-top:2px solid var(--amber); padding:26px 30px 28px; backdrop-filter:blur(8px); }
.panel.center { right:auto; left:50%; transform:translate(-50%,-50%); }
.panel h2 { margin:0; font-size:30px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; }
.panel .kick { font-size:12px; letter-spacing:.3em; color:var(--amber); font-weight:600; margin-bottom:4px; }
.panel p { color:var(--dim); font-size:16px; line-height:1.4; letter-spacing:.02em; margin:10px 0 0; }
.panel .x { position:absolute; right:18px; top:16px; cursor:pointer; color:var(--dim); font-size:13px; letter-spacing:.2em; }
.panel .x:hover { color:var(--bone); }
.grid { display:grid; grid-template-columns:1fr 1fr; gap:14px 26px; margin-top:20px; }
.stat .l { font-size:12px; letter-spacing:.2em; color:var(--dim); font-weight:600; }
.stat .v { font-family:"JetBrains Mono",monospace; font-size:24px; font-weight:700; margin-top:1px; }
.field { margin-top:18px; }
.field label { display:flex; justify-content:space-between; font-size:13px; letter-spacing:.18em; font-weight:600; color:var(--dim); text-transform:uppercase; }
.field label span { font-family:"JetBrains Mono",monospace; color:var(--bone); letter-spacing:0; }
.field input[type=range] { width:100%; margin:8px 0 0; accent-color:var(--amber); height:3px; }
.field input[type=text] { all:unset; display:block; width:100%; margin-top:8px; border-bottom:1px solid var(--dim); padding:6px 0; font-family:"JetBrains Mono",monospace; font-size:20px; text-transform:uppercase; }
.field input[type=text]:focus { border-color:var(--amber); }
.seg { display:flex; margin-top:8px; border:1px solid var(--faint); }
.seg button { all:unset; flex:1; text-align:center; cursor:pointer; padding:7px 0; font-size:14px; font-weight:600; letter-spacing:.14em; text-transform:uppercase; color:var(--dim); }
.seg button.on { background:var(--bone); color:#0b0d0c; }
.acts { display:flex; gap:26px; margin-top:26px; align-items:center; }
.btn { font-size:19px; color:var(--bone); border-bottom:2px solid var(--amber); padding:4px 0; }
.btn.sec { border-color:transparent; color:var(--dim); } .btn:hover { color:var(--amber); }
.err { color:var(--red); font-size:14px; margin-top:8px; min-height:18px; }
.keys { display:grid; grid-template-columns:auto 1fr; gap:6px 18px; margin-top:16px; font-size:15px; color:var(--dim); }
.keys kbd { font-family:"JetBrains Mono",monospace; font-size:12px; color:var(--bone); border:1px solid var(--faint); padding:1px 7px; text-align:center; }
.board { width:100%; border-collapse:collapse; margin-top:14px; font-size:16px; }
.board td { padding:5px 0; border-bottom:1px solid rgba(233,230,220,.1); }
.board td:first-child { width:34px; color:var(--dim); font-family:"JetBrains Mono",monospace; font-size:13px; }
.board td:last-child { text-align:right; font-family:"JetBrains Mono",monospace; font-weight:700; }
.board .ins { font-family:"JetBrains Mono",monospace; font-size:11px; color:var(--amber); margin-right:8px; }
.xp { height:4px; background:var(--faint); margin-top:12px; } .xp i { display:block; height:100%; background:var(--amber); transition:width 1.2s .3s; }
.load { position:absolute; inset:0; background:#070908; display:flex; flex-direction:column; align-items:center; justify-content:center; pointer-events:auto; transition:opacity .7s; }
.load.off { opacity:0; pointer-events:none; }
.load h1 { font-size:64px; font-weight:700; margin:0; letter-spacing:.06em; }
.load p { color:var(--dim); font-size:13px; letter-spacing:.3em; margin-top:10px; }
.load .ln { width:180px; height:2px; background:var(--faint); margin-top:22px; overflow:hidden; } .load .ln i { display:block; width:40%; height:100%; background:var(--amber); animation:ln 1.1s infinite ease-in-out; }
@keyframes ln { 0%{transform:translateX(-100%)} 100%{transform:translateX(260%)} }
@media (max-height:640px) { .brand h1 { font-size:72px; } .nav { margin-top:20px; } .nav button { font-size:21px; } }
`;

export function installStyle(): void {
  const s = document.createElement("style");
  s.textContent = CSS;
  document.head.appendChild(s);
}
