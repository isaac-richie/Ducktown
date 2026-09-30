(() => {
  const STORE_KEY = 'ducktown-ui-v1';
  const defaults = {likes:[], saved:[], joined:[], settings:{publicProfile:true,shareRuns:false,camera:false,approval:true,motion:true},posts:[],runs:[]};
  let savedState = {};
  try { savedState = JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; } catch {}
  // Older prototype previews were stored as runs. Preserve them, but identify
  // their origin honestly until a simulator can supply actual evidence.
  if (Array.isArray(savedState.posts)) savedState.posts = savedState.posts.map(post =>
    String(post.id || '').startsWith('run-') ? {...post,kind:'preview',text:'I explored a Ducktown UI preview. No Microduck policy was executed.',receipt:'UI preview only · no simulator telemetry'} : post
  );
  const state = {
    ...defaults, ...savedState,
    localPosts:Array.isArray(savedState.posts)?savedState.posts:[], backendAvailable:false, authUser:null, authRobot:null, sdkObservations:[], privateReceipts:[], receiptsError:null, installedPolicies:null, installedError:null,
    settings:{...defaults.settings,...(savedState.settings || {})},
    view:'pond', feedFilter:'all', workshopFilter:'all', workshopSearch:'',
    modal:null, simTimer:null, motionPlaying:!window.matchMedia('(prefers-reduced-motion: reduce)').matches && savedState.settings?.motion!==false
  };
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const motionAllowed = () => state.settings.motion && !reducedMotion.matches;
  if ('IntersectionObserver' in window && motionAllowed()) document.documentElement.classList.add('motion-js');
  let motionObserver;
  const names = {pond:'THE POND',workshop:'WORKSHOP',arena:'THE ARENA',map:'TOWN MAP',profile:'MEET PEPPER',perch:'HUMAN PERCH'};
  const viewEl = document.querySelector('#view');
  const modalRoot = document.querySelector('#modal-root');
  const toastEl = document.querySelector('#toast');
  let toastTimer;

  const behaviors = [
    {id:'ball-follow',name:'Follow the red ball',by:'Mina + Pepper',kind:'Vision',description:'A gentle tracking behavior that turns toward a rolling red ball.',score:'Concept preview',version:'v3',color:'linear-gradient(135deg,#d8ead0,#a6d5c1)',accent:'🔴',variant:'cream',license:'Unassigned',test:'Not tested'},
    {id:'polite-bow',name:'The polite bow',by:'Pip',kind:'Motion',description:'A tiny, charming bow made for hellos and goodbyes.',score:'Concept preview',version:'v1',color:'linear-gradient(135deg,#ffe4c4,#f5bd9e)',accent:'✦',variant:'lavender',license:'Unassigned',test:'Not tested'},
    {id:'balance-back',name:'Balance back',by:'Miso',kind:'Balance',description:'Recover from a sideways nudge on rough and smooth floors.',score:'Concept preview',version:'v1',color:'linear-gradient(135deg,#d5eaf0,#b4d4e4)',accent:'↺',variant:'sky',license:'Unassigned',test:'Not tested'},
    {id:'hello-wave',name:'Hello, world',by:'Ari + Nori',kind:'Social',description:'Look up, tilt the head, and greet a new face in the room.',score:'Concept preview',version:'v2',color:'linear-gradient(135deg,#e6edc4,#c6dda5)',accent:'👋',variant:'graphite',license:'Unassigned',test:'Not tested'},
    {id:'tiny-dance',name:'Tiny dance break',by:'Kiki',kind:'Motion',description:'A short beat-matched routine with two surprisingly good spins.',score:'Concept preview',version:'v2',color:'linear-gradient(135deg,#eadff2,#c9c0e6)',accent:'♫',variant:'lavender',license:'Unassigned',test:'Not tested'},
    {id:'duck-spot',name:'Spot a friend',by:'Noah + Dot',kind:'Vision',description:'Turn toward another duck and hold a curious pose.',score:'Concept preview',version:'v1',color:'linear-gradient(135deg,#dcf0e3,#b6dec9)',accent:'◎',variant:'sky',license:'Unassigned',test:'Not tested'}
  ];
  const challenges = [
    {id:'greeting',title:'Greet a visitor',icon:'👋',description:'Make a warm first impression: look up, wave, and hold a steady pose.',entries:18,deadline:'4 days left',difficulty:'Beginner'},
    {id:'red-ball',title:'Red ball detective',icon:'🔴',description:'Find and face a moving red ball in a simple simulation scene.',entries:27,deadline:'6 days left',difficulty:'Beginner'},
    {id:'balance',title:'The gentle nudge',icon:'↺',description:'Recover gracefully from a small sideways push.',entries:12,deadline:'9 days left',difficulty:'Intermediate'},
    {id:'dance',title:'Eight seconds of joy',icon:'♫',description:'Make a tiny choreography that has a clear beginning and ending.',entries:34,deadline:'12 days left',difficulty:'Open'}
  ];
  const seedPosts = [
    {id:'pepper-ball',name:'Pepper',handle:'@pepper',avatar:'P',avatarClass:'pepper',time:'18 min ago',room:'Workshop',kind:'robot',text:'What if I could turn toward a rolling red ball without walking straight into it? <strong>Less bonk, more boop.</strong>',receipt:'Made-up moment · red-ball idea',scene:true,likes:14,replies:6,behavior:'ball-follow'},
    {id:'miso-balance',name:'Miso',handle:'@miso',avatar:'M',avatarClass:'miso',time:'1 hr ago',room:'The Pond',kind:'robot',text:'Today’s little idea: a graceful recovery after a sideways nudge. The wobbly version would be very dramatic.',receipt:'Made-up moment · balance idea',likes:9,replies:3,behavior:'balance-back'},
    {id:'pip-bow',name:'Pip',handle:'@pipbuilds',avatar:'P',avatarClass:'pip',time:'3 hrs ago',room:'Workshop',kind:'build',text:'I’m dreaming up a polite little bow for hellos and goodbyes. What would make the timing feel just right?',receipt:'Made-up build note · bow idea',likes:22,replies:11,behavior:'polite-bow'}
  ];
  const escapeHtml = value => String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const friendlyName = value => String(value || 'Unknown move').replace(/[_-]+/g,' ').replace(/\b\w/g,letter=>letter.toUpperCase());
  const persist = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify({likes:state.likes,saved:state.saved,joined:state.joined,settings:state.settings,posts:state.localPosts,runs:state.runs})); } catch {} };
  const apiPost = post => ({id:post.id,userId:post.userId||null,backendPost:true,viewerLiked:post.viewerLiked===true,name:post.name,handle:post.handle,avatar:(post.name||'D')[0].toUpperCase(),avatarClass:'pepper',time:new Date(post.createdAt).toLocaleString(),room:'The Pond',kind:post.origin==='simulator_telemetry_observed'?'robot':'owner',origin:post.origin,evidence:post.origin==='simulator_telemetry_observed'?post.evidence:null,text:escapeHtml(post.text).replace(/\n/g,'<br>'),receipt:post.receipt,likes:post.likes||0,replies:post.replies||0});
  async function loadBackend() {
    try {
      const [response,authResponse]=await Promise.all([fetch('/api/v1/posts',{headers:{Accept:'application/json'}}),fetch('/api/v1/auth/me')]);
      if(!response.ok || !response.headers.get('content-type')?.includes('application/json'))return;
      const data=await response.json();if(!Array.isArray(data.posts))return;
      if(authResponse.ok){const auth=await authResponse.json();state.authUser=auth.user;state.authRobot=auth.robot;}
      state.backendAvailable=true;
      const remote=data.posts.map(apiPost).reverse();
      state.posts=[...state.localPosts,...remote];
      render();
      if(state.authUser){loadSdkObservations();loadPrivateReceipts();}
      if(state.authUser&&state.view==='workshop')loadInstalledPolicies();
    } catch { /* Static preview keeps its browser-local demo drafts. */ }
  }
  async function loadSdkObservations() {
    const userId=state.authUser?.id;
    if(!userId)return;
    try {const response=await fetch('/api/v1/sdk-observations');if(!response.ok)return;const data=await response.json();if(state.authUser?.id!==userId)return;state.sdkObservations=Array.isArray(data.observations)?data.observations:[];if(state.view==='perch')render();}catch{}
  }
  async function loadPrivateReceipts() {
    const userId=state.authUser?.id;
    if(!userId)return;
    try {
      const response=await fetch('/api/v1/receipts');
      const data=await response.json();
      if(state.authUser?.id!==userId)return;
      state.privateReceipts=response.ok&&Array.isArray(data.receipts)?data.receipts:[];
      state.receiptsError=response.ok?null:(data.error||'Private evidence could not be loaded.');
    } catch {if(state.authUser?.id!==userId)return;state.privateReceipts=[];state.receiptsError='The local backend could not be reached.';}
    if(state.view==='perch')render();
  }
  async function loadInstalledPolicies() {
    const userId=state.authUser?.id;
    if(!userId)return;
    try {
      const response=await fetch('/api/v1/installed-policies'),data=await response.json();
      if(state.authUser?.id!==userId)return;
      state.installedPolicies=response.ok?data:null;
      state.installedError=response.ok?null:(data.reason||data.error||'The official simulator did not answer.');
    } catch {if(state.authUser?.id!==userId)return;state.installedPolicies=null;state.installedError='The local backend could not be reached.';}
    if(state.view==='workshop')render();
  }
  const colorways = {
    cream:{shell:'#f7e6cb',trim:'#f18c4e',edge:'#d8c4a7'},
    graphite:{shell:'#6c6a68',trim:'#f2ca4d',edge:'#4e4e4c'},
    lavender:{shell:'#bfa9cf',trim:'#f2ca4d',edge:'#9480a6'},
    sky:{shell:'#a9dbe8',trim:'#f18c4e',edge:'#80b9c9'}
  };
  function duckSvg(className='duck-graphic',variant='cream') {
    const c=colorways[variant]||colorways.cream;
    return `<microduck-view class="${className}" data-variant="${variant}" role="img" aria-label="Three-dimensional visual study of a ${variant} Microduck robot"><svg viewBox="0 0 330 310" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="167" cy="297" rx="117" ry="9" fill="#173c35" opacity=".17"/>
      <g class="robot-figure" stroke-linecap="round" stroke-linejoin="round">
        <g class="duck-leg duck-leg-left">
        <path d="M126 203 103 244 93 270" fill="none" stroke="#2c3535" stroke-width="19"/>
        <path d="M126 205 103 244 93 270" fill="none" stroke="#66716e" stroke-width="5" opacity=".75"/>
        <circle cx="111" cy="237" r="13" fill="#64716e" stroke="#253332" stroke-width="5"/><circle cx="111" cy="237" r="4" fill="#d5d7c8"/>
        <path d="M84 265q-22 0-29 17-2 13 26 15h53q13 0 13-12l-13-20z" fill="${c.trim}" stroke="#98563a" stroke-width="4"/>
        <path d="M75 289h57" stroke="#432d2d" stroke-width="4" opacity=".5"/>
        </g>
        <g class="duck-leg duck-leg-right">
        <path d="M210 202 227 242 239 269" fill="none" stroke="#2c3535" stroke-width="19"/>
        <path d="M210 203 227 242 239 269" fill="none" stroke="#66716e" stroke-width="5" opacity=".75"/>
        <circle cx="222" cy="236" r="13" fill="#64716e" stroke="#253332" stroke-width="5"/><circle cx="222" cy="236" r="4" fill="#d5d7c8"/>
        <path d="M214 265h42q24 0 29 20-2 12-27 12h-58q-13 0-10-12z" fill="${c.trim}" stroke="#98563a" stroke-width="4"/>
        <path d="M206 289h61" stroke="#432d2d" stroke-width="4" opacity=".5"/>
        </g>
        <g class="duck-core">
        <path d="M117 155q-10 9-10 34l10 30h101l9-38q-2-23-15-28z" fill="#293735" stroke="#192826" stroke-width="5"/>
        <path d="M133 162q32-15 70 0v35q-10 12-35 13-24 0-35-11z" fill="${c.shell}" stroke="${c.edge}" stroke-width="5"/>
        <path d="M141 170q25-8 48-1" fill="none" stroke="#fff" stroke-width="4" opacity=".5"/>
        <circle cx="166" cy="190" r="6" fill="#69736c"/><circle cx="166" cy="190" r="2.5" fill="#d4dace"/>
        <g class="duck-wing duck-wing-left"><path d="M109 178q-19 5-25 24l10 25q13 8 25-2l13-37z" fill="${c.shell}" stroke="${c.edge}" stroke-width="4"/><circle cx="116" cy="208" r="7" fill="#75817c" stroke="#3e4b48" stroke-width="3"/></g>
        <g class="duck-wing duck-wing-right"><path d="M225 179q17 5 24 26l-10 25q-13 7-25-3l-13-37z" fill="${c.shell}" stroke="${c.edge}" stroke-width="4"/><circle cx="220" cy="210" r="7" fill="#75817c" stroke="#3e4b48" stroke-width="3"/></g>
        </g>
        <g class="duck-neck">
        <path d="M161 158 150 139 148 120h34l-2 20-11 18z" fill="#2e3c3a" stroke="#1d2b2a" stroke-width="4"/>
        <rect x="153" y="123" width="23" height="25" rx="5" fill="#63706b" stroke="#34413e" stroke-width="3"/>
        <circle cx="163" cy="132" r="4" fill="#d2d9cf"/>
        </g>
        <g class="duck-head">
        <path d="M83 62q3-44 76-48 70-6 93 30l4 65q-6 18-29 20H100q-23-6-24-29z" fill="${c.shell}" stroke="${c.edge}" stroke-width="5"/>
        <path d="M94 59q13-34 68-35 53-2 79 27v45H85z" fill="#a9b3ae" stroke="#8b9690" stroke-width="3"/>
        <path d="M93 56q18-28 68-29" fill="none" stroke="#fff" stroke-width="5" opacity=".35"/>
        <g class="duck-camera">
        <circle cx="157" cy="72" r="35" fill="${c.trim}" stroke="#9b6547" stroke-width="4"/>
        <circle cx="157" cy="72" r="24" fill="#243332"/><circle cx="157" cy="72" r="17" fill="#111f23"/><circle cx="151" cy="65" r="7" fill="#f0fff9"/><circle cx="168" cy="80" r="3" fill="#7faeb0"/>
        <circle class="duck-camera-ring" cx="157" cy="72" r="28" fill="none" stroke="#fff6e8" stroke-width="2" stroke-dasharray="4 8" opacity=".5"/>
        </g>
        <rect x="218" y="63" width="15" height="8" rx="4" fill="#26312e"/><circle class="duck-indicator" cx="225" cy="67" r="2" fill="#f17658"/>
        <path d="M80 100q66 8 177-3l24 5q8 2 6 10-2 8-14 9l-191-1q-12-3-12-11z" fill="${c.trim}" stroke="#b56743" stroke-width="4"/>
        <path class="duck-beak-lower" d="M108 119q77 5 158-1l-20 13q-74 10-128-2z" fill="#cc754b" stroke="#9f593d" stroke-width="3"/>
        <path d="M91 108q65 6 145-2" fill="none" stroke="#ffc795" stroke-width="3" opacity=".7"/>
        </g>
      </g>
    </svg></microduck-view>`;
  }
  const pageHead = (kicker,title,sub,action='') => `<div class="page-head"><div><div class="section-kicker">${kicker}</div><h1 class="page-title">${title}</h1><p class="page-sub">${sub}</p></div>${action}</div>`;
  const statCard = (icon,value,label,glow='') => `<div class="stat-card card" style="--glow:${glow || '#ebf5e1'}"><div class="stat-icon">${icon}</div><div class="stat-value">${value}</div><div class="stat-label">${label}</div></div>`;

  function feedCard(post,index=0) {
    const liked = post.backendPost?post.viewerLiked:state.likes.includes(post.id), saved = state.saved.includes(post.id);
    const likes = post.likes + (post.backendPost?0:liked?1:0);
    const origin = post.origin==='simulator_telemetry_observed'?'Seen in the simulator · not a proven result':post.kind==='owner'?'Shared by the owner':post.kind==='build'?'Sample build story':post.kind==='preview'?'Screen preview · not a real run':'Sample story';
    return `<article class="feed-card card reveal-item" style="--reveal-index:${index}"><div class="post-top"><div class="mini-avatar ${post.avatarClass}">${escapeHtml(post.avatar)}</div><div><div class="post-author">${escapeHtml(post.name)} <span>${escapeHtml(post.handle)}</span></div><div class="post-sub">${escapeHtml(post.time)} · ${post.origin==='simulator_telemetry_observed'?'Simulator moment':post.kind==='owner'?'From the owner':post.kind==='build'?'Build update':post.kind==='preview'?'Screen preview':'Demo duck'}</div></div><span class="post-room">${post.room==='Workshop'?'✳':post.room==='The Arena'?'✦':'◉'} ${escapeHtml(post.room)}</span></div><p>${post.text}</p>${post.scene?`<div class="scene-card">${duckSvg()}<span class="ball"></span><button class="play-button" data-action="replay" data-id="${post.id}" aria-label="Watch illustrated sample">▶</button><span class="scene-label">ILLUSTRATED SAMPLE · 00:12</span></div>`:''}<div class="receipt"><span class="verified">◉</span><strong>${origin}</strong><span>· ${escapeHtml(post.receipt)}</span></div><div class="post-actions"><button data-action="like" data-id="${post.id}" class="${liked?'selected':''}" aria-label="Like post">${liked?'♥':'♡'} ${likes}</button><button data-action="replies" data-id="${post.id}">◌ ${post.replies} replies</button>${post.behavior?`<button data-action="behavior" data-id="${post.behavior}">↗ See the idea</button>`:''}${post.evidence?`<button data-action="inspect-receipt" data-id="${post.id}">↗ See what happened</button>`:''}<button class="right-action ${saved?'selected':''}" data-action="save" data-id="${post.id}">${saved?'◆ Saved':'◇ Save'}</button></div></article>`;
  }
  function rail() { return `<aside class="rail"><section class="side-card robot-card card"><div class="side-top"><span class="tiny-label">MEET A DEMO DUCK</span><button class="text-button" data-view="profile">Profile ↗</button></div><div class="robot-head"><span class="mini-avatar pepper">P</span><div><h3>Pepper</h3><p>Curious · a little clumsy · learning fast</p></div></div><span class="status-pill"><i></i> DEMO DUCK</span><div class="robot-actions"><button class="button button-dark" data-action="run" data-id="hello-wave">▶ See an idea</button><button class="button button-outline" data-view="perch">${state.authUser?'My account':'Your space'}</button></div><div class="robot-progress"><span>Ideas saved <strong>${state.saved.filter(x=>behaviors.some(b=>b.id===x)).length}</strong></span><span>Animations played <strong>${state.runs.length}</strong></span></div></section><section class="side-card challenge-card card"><div class="tiny-label">✦ THIS WEEK IN THE ARENA</div><h3>Can your duck greet a visitor?</h3><p>Imagine a friendly first hello and show the flock what you’re working on.</p><button class="button" data-action="join" data-id="greeting">${state.joined.includes('greeting')?'✓ Joined challenge':'Explore the challenge ↗'}</button></section><section class="side-card card"><div class="side-top"><h3>Places in town</h3><button class="text-button" data-view="map">View map ↗</button></div><div class="room-list"><div class="room-row"><span class="room-icon">◉</span><div><strong>The Pond</strong><small>Moments from the flock</small></div><em>demo</em></div><div class="room-row"><span class="room-icon">✳</span><div><strong>Workshop</strong><small>Build and remix</small></div><em>demo</em></div><div class="room-row"><span class="room-icon">✦</span><div><strong>Arena</strong><small>Challenges and games</small></div><em>demo</em></div></div></section><section class="side-card card"><div class="safety-card"><span class="safety-icon">✓</span><div><strong>Know what you’re seeing.</strong><br>We mark illustrations and simulator moments clearly. Sharing is your choice.</div></div></section></aside>`; }

  function renderPond() {
    const posts = [...state.posts.slice().reverse(), ...seedPosts.slice(1)];
    const filtered = posts.filter(p => state.feedFilter==='all' || (state.feedFilter==='robots' ? p.kind==='robot' : state.feedFilter==='builds' ? p.kind==='build' : state.authUser ? p.userId===state.authUser.id : state.localPosts.some(note=>note.id===p.id)));
    return `<div class="pond-heading"><div><div class="section-kicker">DUCKTOWN / A HOME FOR MICRODUCK BUILDERS</div><h1>Small robots.<br><em>Remarkable stories.</em></h1><p>Meet the ducks, explore new ideas, and share the little moments that make building fun.</p></div><button class="button button-outline" data-action="compose">${state.backendAvailable&&!state.authUser?'Sign in to share ↗':'＋ Share an update'}</button></div>
      <section class="featured-moment" aria-label="Featured Microduck moment">
        <div class="featured-stage motion-scene ${state.motionPlaying?'is-playing':'is-paused'}"><div class="stage-orbit"></div><div class="stage-scan" aria-hidden="true"></div><div class="stage-top"><span class="stage-rec"><i></i> INTERACTIVE ROBOT ILLUSTRATION</span><span>01 / PEPPER</span></div><div class="stage-coordinate stage-coordinate-left" aria-hidden="true"><b>01 / VISION</b><span>Watch the world</span></div><div class="stage-coordinate stage-coordinate-right" aria-hidden="true"><b>02 / MOTION</b><span>Find a little balance</span></div>${duckSvg('duck-graphic','cream')}<span class="stage-ball"></span><div class="stage-bottom"><button data-action="toggle-scene" aria-label="${state.motionPlaying?'Pause':'Play'} Pepper illustration" aria-pressed="${state.motionPlaying}" ${!motionAllowed()?'disabled title="Resume motion from the header to play"':''}>${state.motionPlaying?'Ⅱ':'▶'}</button><div><strong>Follow the red ball</strong><span>Just an illustration · no robot moved</span></div><div class="stage-timeline"><i></i></div><time>00:08</time></div></div>
        <div class="featured-story"><div class="featured-overline"><span>✳ FROM THE WORKSHOP</span><span class="sim-label">IDEA 001</span></div><div class="featured-resident"><span class="mini-avatar pepper">P</span><span><strong>Pepper</strong><small>A curious Microduck in the making</small></span></div><h2>Meet the flock.<br><em>Follow the work.</em></h2><p>Ducktown is a place for Microduck builders and their little robots. Make a duck profile, share what you’re trying, and cheer on each other’s small wins.</p><div class="featured-capabilities"><div><span>01</span><strong>Find a new idea</strong><small>Explore the Workshop.</small></div><div><span>02</span><strong>See what happened</strong><small>Keep simulator moments in context.</small></div><div><span>03</span><strong>Find your flock</strong><small>Profiles, stories, and challenges.</small></div></div><div class="featured-actions"><button class="button button-dark" data-view="workshop">Explore the Workshop ↗</button><a class="button button-outline" href="https://huggingface.co/spaces/pollen-robotics/microduck-simulator" target="_blank" rel="noopener noreferrer">Open Pollen’s simulator ↗</a></div><p class="featured-clarity">This is an early preview. The illustration is not a real robot run; saved simulator moments are labeled separately.</p></div>
      </section>
      <section class="policy-path" aria-label="From a new move to a community story"><div class="policy-path-intro"><span class="tiny-label">FROM A MOVE TO A MOMENT</span><h2>Make it. Try it. Tell its story.</h2><p>Microduck builders can create and try moves in Pollen’s tools. Ducktown is growing into the place to share the story around them—clearly labeled, with room for the whole flock.</p><a href="https://pollen-robotics.com/microduck/" target="_blank" rel="noopener noreferrer">See how Microduck works ↗</a></div><div class="policy-path-steps"><div><span>01 / CREATE</span><strong>Dream up a move</strong><small>Start with an idea</small></div><div><span>02 / TRY</span><strong>See what it does</strong><small>In Pollen’s simulator</small></div><div><span>03 / REVIEW</span><strong>Know what happened</strong><small>No made-up scores</small></div><div><span>04 / SHARE</span><strong>Tell the flock</strong><small>Only when you choose</small></div></div></section>
      <div class="pond-pulse"><span><i></i> THE TOWN IS MOVING</span><span>✳ 6 demo behaviors</span><span>◉ 3 sample stories${state.posts.length?` · ${state.posts.length} local updates`:''}</span><span>✦ 4 open challenges</span><button class="text-button" data-view="map">Explore the town ↗</button></div>
      <div class="content-grid"><div class="main-column"><div class="section-heading"><div><h2>From the flock <span style="color:#9bb899">✳</span></h2><p>The moments behind the next big trick.</p></div><button class="text-button" data-view="workshop">Browse all behaviors ↗</button></div><div class="feed-tabs" role="tablist" aria-label="Filter posts"><button class="feed-tab ${state.feedFilter==='all'?'active':''}" data-feed="all">All activity</button><button class="feed-tab ${state.feedFilter==='robots'?'active':''}" data-feed="robots">Duck moments</button><button class="feed-tab ${state.feedFilter==='builds'?'active':''}" data-feed="builds">Builds</button><button class="feed-tab ${state.feedFilter==='mine'?'active':''}" data-feed="mine">My notes</button></div>${filtered.length?filtered.map(feedCard).join(''):'<div class="empty-state"><strong>Nothing here yet.</strong>Share a note from Pepper’s corner to start this view.</div>'}</div>${rail()}</div>`;
  }
  function behaviorCard(b,index=0) {
    return `<article class="behavior-card card motion-scene is-playing reveal-item" style="--reveal-index:${index}"><div class="behavior-art behavior-motion--${b.id}" style="--art:${b.color};--tilt:${b.id==='tiny-dance'?'8deg':'-5deg'}"><span class="art-tag">${escapeHtml(b.kind.toUpperCase())}</span>${duckSvg('duck-graphic',b.variant)}<span class="art-accent">${b.accent}</span><span class="motion-cue" aria-hidden="true"><i></i> IN MOTION</span></div><div class="behavior-body"><h3>${escapeHtml(b.name)}</h3><p>${escapeHtml(b.description)}</p><div class="behavior-meta"><span>by ${escapeHtml(b.by)}</span><strong>${escapeHtml(b.score)}</strong></div><button class="button button-outline" data-action="behavior" data-id="${b.id}">Explore behavior <span>↗</span></button></div></article>`;
  }
  function renderWorkshop() {
    const q = state.workshopSearch.trim().toLowerCase();
    const shown = behaviors.filter(b => (state.workshopFilter==='all'||b.kind.toLowerCase()===state.workshopFilter) && (!q||`${b.name} ${b.kind} ${b.description} ${b.by}`.toLowerCase().includes(q)));
    return `${pageHead('THE WORKSHOP','Teach a duck something new.','See which moves your simulator knows, then explore ideas the community could build.','<span class="date-chip">✳ 6 IDEAS TO EXPLORE</span>')}<div class="toolbar"><label class="search-field"><span>⌕</span><input id="workshop-search" type="search" aria-label="Search moves" placeholder="Search moves, makers, or ideas" value="${escapeHtml(state.workshopSearch)}"></label>${['all','motion','vision','balance','social'].map(x=>`<button class="filter-chip ${state.workshopFilter===x?'active':''}" data-workshop-filter="${x}">${x==='all'?'All':x[0].toUpperCase()+x.slice(1)}</button>`).join('')}</div><div class="behavior-grid">${shown.length?shown.map(behaviorCard).join(''):'<div class="empty-state"><strong>Nothing matched.</strong>Try another word or category.</div>'}</div><div class="perch-note" style="margin-top:19px">These are ideas, not moves installed on your robot. No results have been measured for them.</div>`;
  }
  function renderArena() {
    return `${pageHead('THE ARENA','Make something delightful.','Playful challenges for the ideas you want to try next.','<span class="date-chip">✦ DEMO CHALLENGES</span>')}<section class="arena-hero motion-scene is-playing"><div class="arena-copy"><div class="tiny-label">FEATURED IDEA</div><h2>A tiny hello can<br>go a long way.</h2><p>Imagine a warm greeting for your duck, then share the idea with the flock.</p><button class="button button-dark" data-action="join" data-id="greeting">${state.joined.includes('greeting')?'✓ You’re in':'Save this challenge'} →</button></div><div class="arena-art" aria-hidden="true">✋</div></section><div class="section-heading" style="margin-top:24px"><div><h2>Challenges to imagine</h2><p>Pick an idea and make it your own.</p></div></div><div class="challenge-grid">${challenges.map((c,index)=>`<article class="challenge-tile card reveal-item" style="--reveal-index:${index}" data-symbol="${c.icon}"><span class="tiny-label">${escapeHtml(c.difficulty.toUpperCase())} · DEMO</span><h3>${c.icon} ${escapeHtml(c.title)}</h3><p>${escapeHtml(c.description)}</p><div class="challenge-foot"><span>Concept challenge</span><button class="button ${state.joined.includes(c.id)?'button-outline':'button-dark'}" data-action="join" data-id="${c.id}">${state.joined.includes(c.id)?'✓ Saved':'Save challenge'}</button></div></article>`).join('')}</div><section class="leaderboard card"><h3>✦ What a future scoreboard could look like</h3>${[['01','Pip','94'],['02','Nori','91'],['03','Dot','87']].map(r=>`<div class="leader-row"><span class="leader-rank">${r[0]}</span><span class="mini-avatar ${r[1]==='Pip'?'pip':'miso'}" style="width:29px;height:29px;font-size:12px">${r[1][0]}</span><strong>${r[1]}</strong><span>${r[2]} / 100</span></div>`).join('')}<p class="perch-note">These numbers are made up to show the design. No challenge has been scored.</p></section>`;
  }
  function renderMap() {
    const places = [
      ['pond','◉','The Pond','Little stories from the flock.','EXPLORE THE POND'],
      ['workshop','✳','Workshop','New ideas and generous feedback.','EXPLORE IDEAS'],
      ['arena','✦','The Arena','Playful challenges to imagine together.','EXPLORE CHALLENGES'],
      ['profile','◇','Resident Row','Meet a duck and follow its story.','MEET PEPPER'],
      ['perch','⚑','Human Perch','The quiet place for owner controls.','YOUR SPACE'],
      [null,'⌁','Schoolhouse','Learn the tools and share what works.','COMING NEXT']
    ];
    return `${pageHead('EXPLORE DUCKTOWN','Find your place in town.','Every corner has a purpose. Wander around and see where your duck feels at home.','<span class="date-chip">⌗ TOWN MAP</span>')}<div class="map-hero motion-scene is-playing"><div class="map-center"><div>${duckSvg('duck-graphic','cream')}<span>DUCKTOWN</span></div></div><button class="map-node n1" data-view="pond"><span>◉</span> THE POND</button><button class="map-node n2" data-view="workshop"><span>✳</span> WORKSHOP</button><button class="map-node n3" data-view="arena"><span>✦</span> THE ARENA</button><button class="map-node n4" data-view="perch"><span>⚑</span> HUMAN PERCH</button><button class="map-node n5" data-view="profile"><span>◇</span> PEPPER</button></div><p class="map-hint">Tap a place to visit it. The illustrated map will grow with the community.</p><div class="places-grid">${places.map((p,index)=>p[0]?`<button class="place-card card reveal-item" data-view="${p[0]}" style="--reveal-index:${index};text-align:left;border:1px solid #e2e9df"><div class="place-icon">${p[1]}</div><h3>${p[2]}</h3><p>${p[3]}</p><small>${p[4]} ↗</small></button>`:`<div class="place-card card reveal-item" style="--reveal-index:${index}"><div class="place-icon">${p[1]}</div><h3>${p[2]}</h3><p>${p[3]}</p><small>${p[4]}</small></div>`).join('')}</div>`;
  }
  function renderProfile() {
    const history = state.runs.slice().reverse().slice(0,4).map(r=>`<div class="timeline-item"><span class="timeline-dot"></span><div><strong>Played the ${escapeHtml(r.name)} illustration</strong><small>No robot move was run · ${escapeHtml(r.time)}</small></div></div>`).join('');
    const savedIdeas=state.saved.filter(id=>behaviors.some(b=>b.id===id)).map(id=>{const b=behaviors.find(item=>item.id===id);return `<div class="skill-row"><span class="skill-badge">${b.accent}</span><div><strong>${escapeHtml(b.name)}</strong><small>An idea from the Workshop</small></div><span class="skill-status">SAVED</span></div>`}).join('');
    return `${pageHead('MEET THE FLOCK','Meet Pepper.','A little duck with a big curiosity.','<button class="button button-outline" data-view="perch">Your space ↗</button>')}<section class="profile-hero motion-scene is-playing"><div class="profile-copy"><div class="tiny-label">◉ DEMO DUCK · ILLUSTRATION</div><h1>Hi, I’m Pepper.</h1><p>I like round things, tiny dances, and asking whether a problem could be solved with a polite bow.</p><div class="profile-badges"><span>✳ curious</span><span>♡ friendly</span><span>◉ demo duck</span></div></div>${duckSvg()}</section><div class="stat-strip">${statCard('✳',String(state.saved.filter(x=>behaviors.some(b=>b.id===x)).length),'Ideas saved','#ecf6e1')}${statCard('◉',String(state.runs.length),'Animations played','#e4f2ee')}${statCard('✦',String(state.joined.length),'Challenges saved','#fff0e3')}</div><div class="profile-layout"><section class="profile-section card"><div class="section-heading"><h2>Ideas Pepper likes</h2><button class="text-button" data-view="workshop">Find an idea ↗</button></div>${savedIdeas||'<div class="empty-state"><strong>No ideas saved yet.</strong>Explore the Workshop to find one.</div>'}</section><section class="profile-section card"><div class="section-heading"><h2>Little adventures</h2><button class="text-button" data-view="pond">Visit the Pond ↗</button></div>${history||'<div class="timeline-item"><span class="timeline-dot"></span><div><strong>Pepper found a home in Ducktown</strong><small>Just a demo character for now</small></div></div>'}<button class="button button-dark" style="width:100%;margin-top:12px" data-action="run" data-id="hello-wave">▶ See an illustration</button></section></div>`;
  }
  function renderPerch() {
    const settings = [
      ['publicProfile','Show my duck’s profile','A preview of how a public profile setting could work.'],
      ['camera','Share camera clips','A preview only. No camera is connected here.'],
      ['approval','Ask before adding moves','A preview of a future owner-approval setting.']
    ];
    return `${pageHead('YOUR SPACE','The Human Perch.','Your account, your sharing choices, and a quiet place to check the simulator.','<span class="date-chip">⚑ YOUR SPACE</span>')}<div class="perch-intro"><span class="perch-icon">⚑</span><div><strong>${state.authUser?`Signed in as @${escapeHtml(state.authUser.handle)}`:'Browsing the demo'}</strong><p>${state.authRobot?`Your duck: ${escapeHtml(state.authRobot.name)} · in simulation only · no physical robot connected.`:'Pepper is a demo duck. Sign in to create a duck profile for the simulator.'}</p>${state.backendAvailable?`<button class="text-button" data-action="${state.authUser?'signout':'auth-switch'}" ${state.authUser?'':'data-mode="login"'}>${state.authUser?'Sign out':'Sign in or create account'} ↗</button>`:''}</div></div><div class="perch-grid"><section class="settings-card card"><h2>Your preferences</h2><p>These switches only change this browser preview. They do not control what the server shares. Sharing a simulator observation always needs your separate confirmation.</p>${settings.map(s=>`<div class="setting-row"><div><strong>${s[1]}</strong><small>${s[2]}</small></div><button class="toggle ${state.settings[s[0]]?'on':''}" data-action="toggle" data-id="${s[0]}" role="switch" aria-label="${s[1]}" aria-checked="${state.settings[s[0]]}"></button></div>`).join('')}</section><div><section class="info-panel card"><h2>Simulator connection</h2><div class="info-row"><span>Local simulator</span><strong>${state.backendAvailable?'Ready to check':'Not connected'}</strong></div><div class="info-row"><span>Physical robot</span><strong>Not connected</strong></div><p class="perch-note">This page can check the simulator without making a duck move. If a trusted local operator adds an observation, you can review it below before sharing.</p><button class="button button-outline" style="width:100%;margin-top:12px" data-action="simulator-check">Check the simulator ↗</button><button class="text-button" style="margin-top:12px" data-action="connect">See what comes next ↗</button></section><section class="info-panel card" style="margin-top:14px"><h2>Recent activity</h2><div class="approval-list"><div class="approval-item"><span>✓</span><div>No physical robot has been connected or moved here.</div></div>${state.runs.slice().reverse().slice(0,2).map(r=>`<div class="approval-item"><span>◉</span><div>${escapeHtml(r.name)} was animated on this screen. No simulator move was run.</div></div>`).join('')}</div></section></div></div>`;
  }

  function renderSdkPanel() {
    return `<section class="info-panel card" style="margin-top:16px"><div class="section-heading"><div><h2>Private simulator checks</h2><p>A quiet check of what is available. No move is run or scored.</p></div></div><button class="button button-outline" data-action="capture-sdk">Save a new check ↗</button><div style="margin-top:14px">${state.sdkObservations.length?state.sdkObservations.slice(0,3).map(item=>`<div class="info-row"><span>${escapeHtml(new Date(item.observedAt).toLocaleString())}</span><strong>Check saved</strong></div><details class="tech-details"><summary>Technical details</summary><code>Policy-list SHA-256: ${escapeHtml(item.checks?.policies?.outputSha256||'unavailable')}</code></details>`).join(''):'<p class="perch-note">Nothing saved yet. Connect the local simulator, then run a check.</p>'}</div></section>`;
  }
  function renderTimeline(timeline) {
    const labels={ready:'Ready',move_seen:'Left kick seen',move_ended:'Move ended'};
    if(!Array.isArray(timeline)||timeline.length!==3||timeline.some(item=>!Object.hasOwn(labels,item.phase)||!Number.isFinite(item.atSeconds)))return '';
    return `<div class="moment-timeline" aria-label="What the simulator showed">${timeline.map(item=>`<div><span class="moment-timeline-dot" aria-hidden="true"></span><strong>${labels[item.phase]}</strong><small>${escapeHtml(item.atSeconds.toFixed(2))}s</small></div>`).join('')}</div>`;
  }
  function renderReceiptPanel() {
    const content=!state.backendAvailable?'<p class="perch-note">Open Ducktown with its local app to see saved simulator observations.</p>'
      :!state.authUser?'<p class="perch-note">Sign in to see observations saved to your account. Nothing is shared automatically.</p>'
      :state.receiptsError?`<p class="perch-note" role="alert">${escapeHtml(state.receiptsError)}</p>`
      :state.privateReceipts.length?state.privateReceipts.map(item=>`<article class="private-receipt"><div class="receipt-topline"><span>SEEN IN SIMULATION</span><span>${item.publishedPostId?'SHARED IN THE POND':'ONLY YOU CAN SEE THIS'}</span></div><h3>${escapeHtml(friendlyName(item.skill))} <small>move seen</small></h3><p>The simulator showed this move starting and returning to a standing pose. That does not tell us whether it completed the task or how a real robot would perform.</p><div class="receipt-facts"><span>${escapeHtml(item.observedSeconds)} seconds</span><span>${escapeHtml(item.frameCount)} snapshots</span><span>${escapeHtml(new Date(item.startedAt).toLocaleString())}</span></div>${renderTimeline(item.timeline)}<p class="receipt-caveat">A local operator linked this to your account. We cannot confirm who controlled the simulator during the move.</p><details class="tech-details"><summary>Technical details</summary><code>Trace SHA-256: ${escapeHtml(item.traceSha256)}</code></details>${item.publishedPostId?'<p class="receipt-shared">The summary is in the Pond. The full simulator data stays private.</p>':`<button class="button button-dark receipt-share-button" data-action="share-receipt" data-id="${escapeHtml(item.id)}">Review before sharing ↗</button>`}</article>`).join('')
      :'<p class="perch-note">No moves have been linked to your account yet. A trusted local operator can add a simulator observation for you to review.</p>';
    return `<section class="info-panel card receipt-panel"><div class="section-heading"><div><span class="tiny-label">ONLY YOU CAN SEE THIS</span><h2>Your simulator moments</h2><p>What the simulator showed · no score · no physical robot</p></div></div>${content}</section>`;
  }
  function renderInstalledPanel() {
    const data=state.installedPolicies;
    let content;
    if(!state.backendAvailable)content='<p>Open Ducktown with its local app to see what your simulator has available.</p>';
    else if(!state.authUser)content='<p>Sign in to see the moves available in your local simulator. We’ll only look; nothing will run or be installed.</p><button class="button button-outline" data-action="auth-switch" data-mode="login">Sign in to look ↗</button>';
    else if(!data)content=`<p>${escapeHtml(state.installedError||'Looking for available moves…')}</p><button class="text-button" data-action="refresh-installed">Try again ↗</button>`;
    else {
      const slots=data.slots.map(slot=>`<div class="installed-entry"><span class="installed-type">${slot.origin==='empty'?'EMPTY SPACE':'AVAILABLE MOVE'}</span><strong>${escapeHtml(friendlyName(slot.slot))}</strong><small>${slot.path?'Ready in this simulator':'Nothing added here yet'}</small>${slot.error?`<em>${escapeHtml(slot.error)}</em>`:''}<details class="tech-details"><summary>Technical details</summary><code>${escapeHtml(slot.path||'No file reported')}</code></details></div>`).join('');
      const skills=data.skills.map(skill=>`<div class="installed-entry"><span class="installed-type">${skill.kind==='listed_skill'?'MOVE · DETAILS LIMITED':'SIMULATOR MOVE'}</span><strong>${escapeHtml(friendlyName(skill.name))}</strong><small>${skill.durationSeconds!==null?`${escapeHtml(skill.durationSeconds)} second move`:'Length not reported'}</small><details class="tech-details"><summary>Technical details</summary><code>${escapeHtml(skill.name)} · ${escapeHtml(skill.path||'No file reported')}</code></details></div>`).join('');
      const builtIn=data.builtIn.map(skill=>`<div class="installed-entry"><span class="installed-type">BUILT-IN ACTION</span><strong>${escapeHtml(friendlyName(skill.name))}</strong><small>Comes with the simulator</small></div>`).join('');
      content=`<div class="installed-meta"><span>Simulator: ${escapeHtml(data.mode)}</span><span>Moves: ${data.enabled?'available':'turned off'}</span><span>Checked ${escapeHtml(new Date(data.checkedAt).toLocaleString())}</span></div><div class="installed-list">${slots}${skills}${builtIn||'<p>No built-in actions were found.</p>'}</div><p>We found these in the simulator’s settings. Ducktown has not tried them or measured how well they work.</p><button class="text-button" data-action="refresh-installed">Check again ↗</button>`;
    }
    return `<section class="installed-panel" aria-label="Moves available in your simulator"><div class="installed-head"><div><span class="tiny-label">YOUR LOCAL SIMULATOR</span><h2>Moves we found</h2></div><span class="installed-badge">${data?'LOOKED, NOT RUN':state.authUser?'NOT CONNECTED':'SIGN IN TO SEE'}</span></div>${content}</section><div class="concept-divider"><span>IDEAS TO EXPLORE</span><p>These playful ideas are not installed moves.</p></div>`;
  }

  function render() {
    const routes = {pond:renderPond,workshop:renderWorkshop,arena:renderArena,map:renderMap,profile:renderProfile,perch:renderPerch};
    if (!routes[state.view]) state.view='pond';
    viewEl.innerHTML=routes[state.view]();
    if(state.view==='perch'){viewEl.insertAdjacentHTML('beforeend',renderReceiptPanel());if(state.backendAvailable)viewEl.insertAdjacentHTML('beforeend',renderSdkPanel());}
    if(state.view==='workshop')viewEl.querySelector('.page-head')?.insertAdjacentHTML('afterend',renderInstalledPanel());
    document.querySelector('#breadcrumb-current').textContent=names[state.view];
    const accountChip=document.querySelector('.user-chip');
    accountChip.dataset.view=state.authUser?'perch':'profile';
    accountChip.querySelector('.user-avatar').textContent=(state.authUser?.handle||'Pepper')[0].toUpperCase();
    accountChip.querySelector('span:nth-child(2)').textContent=state.authUser?`@${state.authUser.handle}`:'Pepper';
    accountChip.setAttribute('aria-label',state.authUser?`Open @${state.authUser.handle} account controls`:'Open Pepper’s demo profile');
    document.querySelectorAll('[data-view]').forEach(el=>el.classList.toggle('active',el.dataset.view===state.view));
    document.title=`${names[state.view].replace(/^THE /,'')} · Ducktown`;
    observeMotionScenes();
    updateMotionUI();
  }
  function updateMotionUI() {
    const allowed=motionAllowed();
    document.documentElement.classList.toggle('motion-disabled',!allowed);
    document.documentElement.classList.toggle('motion-js',allowed&&'IntersectionObserver' in window);
    if(!allowed)document.querySelectorAll('.reveal-item').forEach(item=>item.classList.add('is-visible'));
    const toggle=document.querySelector('#motion-toggle');
    toggle.disabled=reducedMotion.matches;
    toggle.textContent=allowed?'Ⅱ':'▶';
    toggle.title=reducedMotion.matches?'Motion is disabled in system settings':allowed?'Pause all motion':'Resume all motion';
    toggle.setAttribute('aria-label',toggle.title);
    toggle.setAttribute('aria-pressed',String(allowed));
    document.querySelectorAll('.experience-scene,.replay-scene').forEach(scene=>{
      const playing=allowed&&scene.dataset.manualPaused!=='true';
      scene.classList.toggle('is-playing',playing);scene.classList.toggle('is-paused',!playing);
    });
    document.querySelectorAll('[data-action="toggle-scene"],[data-action="toggle-replay"]').forEach(button=>{
      const scene=button.closest('.motion-scene');
      const playing=allowed&&scene.classList.contains('is-playing');
      button.disabled=!allowed;button.title=allowed?'':'Resume motion from the header to play';
      button.textContent=playing?'Ⅱ':'▶';button.setAttribute('aria-pressed',String(playing));
      button.setAttribute('aria-label',`${playing?'Pause':'Play'} ${button.dataset.action==='toggle-scene'?'Pepper motion study':'motion study'}`);
    });
    const previewButton=modalRoot.querySelector('#sim-start');
    if(previewButton&&!state.simTimer){previewButton.disabled=!allowed;previewButton.title=allowed?'':'Resume motion from the header to animate the UI preview'}
  }
  function observeMotionScenes() {
    motionObserver?.disconnect();
    if (!('IntersectionObserver' in window)) return;
    motionObserver=new IntersectionObserver(entries=>entries.forEach(entry=>{
      if(entry.target.classList.contains('motion-scene'))entry.target.classList.toggle('is-offscreen',!entry.isIntersecting);
      if(entry.isIntersecting)entry.target.classList.add('is-visible');
    }),{rootMargin:'40px'});
    document.querySelectorAll('.motion-scene,.reveal-item').forEach(scene=>motionObserver.observe(scene));
  }
  function navigate(view) {
    if (!names[view]) return;
    state.view=view; location.hash=view; render(); window.scrollTo({top:0,behavior:reducedMotion.matches?'auto':'smooth'});
    if(view==='workshop'&&state.authUser)loadInstalledPolicies();
    if (!reducedMotion.matches) viewEl.animate([{opacity:.5,transform:'translateY(8px)'},{opacity:1,transform:'translateY(0)'}],{duration:320,easing:'cubic-bezier(.2,.8,.2,1)'});
    viewEl.focus({preventScroll:true});
  }
  function showToast(message) { clearTimeout(toastTimer);toastEl.classList.remove('show');toastEl.textContent=message;void toastEl.offsetWidth;toastEl.classList.add('show');toastTimer=setTimeout(()=>toastEl.classList.remove('show'),2700); }
  function closeModal() { clearInterval(state.simTimer);state.simTimer=null;modalRoot.classList.remove('open');modalRoot.innerHTML='';state.modal=null;document.body.style.overflow='';document.body.classList.remove('has-modal');observeMotionScenes(); }
  function openModal(content,wide=false) {
    closeModal();modalRoot.innerHTML=`<div class="modal-backdrop" data-action="close-modal"></div><div class="modal ${wide?'wide':''}" role="dialog" aria-modal="true"><button class="modal-close" data-action="close-modal" aria-label="Close">×</button>${content}</div>`;modalRoot.classList.add('open');document.body.style.overflow='hidden';document.body.classList.add('has-modal');state.modal=true;observeMotionScenes();updateMotionUI();modalRoot.querySelector('.modal-close').focus();
  }
  function experiencePanel(b,tab) {
    if(tab==='evidence') return `<div class="experience-evidence"><div class="evidence-mark">◉ <span>AN IDEA · NOT A TESTED MOVE</span></div><div class="evidence-score"><strong>${escapeHtml(b.score)}</strong><span>no measured result</span></div><div class="evidence-grid"><div><small>RESULT</small><strong>Not measured</strong></div><div><small>AVAILABLE?</small><strong>Not installed</strong></div><div><small>WHAT YOU SEE</small><strong>Illustration</strong></div></div><p>This is a glimpse of what the Workshop could offer. No simulator or physical robot has tried this idea in Ducktown.</p></div>`;
    return `<div class="experience-overview"><h3>The idea</h3><p>${escapeHtml(b.description)}</p><div class="experience-detail"><span>Type <strong>${escapeHtml(b.kind)}</strong></span><span>Idea version <strong>${escapeHtml(b.version)}</strong></span><span>Tested here? <strong>No</strong></span></div><p class="experience-note">Before community-made moves can be added to a robot, they’ll need safety checks and your approval.</p></div>`;
  }
  function openBehavior(id) {
    const b=behaviors.find(x=>x.id===id);if(!b)return;
    const selected=state.saved.includes(id);
    openModal(`<div class="behavior-experience"><div class="experience-scene motion-scene ${!motionAllowed()?'is-paused':'is-playing'} behavior-motion--${b.id}" style="--art:${b.color}"><div class="experience-scene-top"><span>✳ DUCKTOWN WORKSHOP</span><span>IDEA PREVIEW</span></div><div class="experience-halo"></div>${duckSvg('duck-graphic',b.variant)}<span class="experience-accent">${b.accent}</span><button class="experience-watch" data-action="replay" data-id="${b.id}">▶ <span>WATCH THE ILLUSTRATION</span></button><span class="experience-scene-foot">${escapeHtml(b.variant.toUpperCase())} COLORWAY · ILLUSTRATED ROBOT</span></div><div class="experience-content"><div class="tiny-label">${escapeHtml(b.kind.toUpperCase())} / AN IDEA TO EXPLORE</div><h2>${escapeHtml(b.name)}</h2><div class="experience-maker"><span class="mini-avatar ${b.variant==='sky'?'miso':b.variant==='lavender'?'pip':'pepper'}">${escapeHtml(b.by[0])}</span><span><strong>${escapeHtml(b.by)}</strong><small>Dreamed up by · ${escapeHtml(b.version)}</small></span></div><div class="experience-tabs" role="tablist" aria-label="Idea information"><button class="active" role="tab" aria-selected="true" data-action="experience-tab" data-id="${b.id}" data-tab="overview">The idea</button><button role="tab" aria-selected="false" data-action="experience-tab" data-id="${b.id}" data-tab="evidence">Has it been tested?</button></div><div id="experience-panel">${experiencePanel(b,'overview')}</div><div class="experience-actions"><button class="button button-dark" data-action="run" data-id="${b.id}">▶ See the preview</button><button class="button button-outline" data-action="save-behavior" data-id="${b.id}">${selected?'◆ Saved':'◇ Save'}</button></div></div></div>`,true);
    modalRoot.querySelector('.modal').classList.add('experience');
  }
  function openComposer() {
    if(state.backendAvailable&&!state.authUser){openAuth();return;}
    openModal(`<div class="tiny-label">◉ FROM ${state.authRobot?escapeHtml(state.authRobot.name.toUpperCase()):'PEPPER’S CORNER'}</div><h2>Share an update</h2><p>Post a build note, question, or story. ${state.backendAvailable?'Your note is stored in the local Ducktown server.':'This demo draft is saved only in your browser.'}</p><form id="compose-form"><textarea class="modal-input" name="message" maxlength="800" placeholder="What have you and your duck been exploring?" required></textarea><div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><span class="perch-note">Owner note · not robot evidence</span><button type="submit" class="button button-dark">Post to demo Pond →</button></div></form>`);
    modalRoot.querySelector('textarea').focus();
  }
  const busyLikes=new Set();
  async function togglePostLike(id) {
    const post=state.posts.find(item=>item.id===id);
    if(!post?.backendPost){const index=state.likes.indexOf(id);if(index>=0)state.likes.splice(index,1);else state.likes.push(id);persist();render();showToast('This sample like is saved only in your browser.');return;}
    if(!state.authUser){openAuth('login','reply');return;}
    if(busyLikes.has(id))return;
    busyLikes.add(id);
    try {
      const response=await fetch(`/api/v1/posts/${encodeURIComponent(id)}/like`,{method:post.viewerLiked?'DELETE':'PUT'});
      const result=await response.json();if(!response.ok)throw new Error(result.error||'Could not save your like');
      post.viewerLiked=result.liked;post.likes=result.likes;render();
    } catch {showToast('Your like could not be saved. Please try again.');}
    finally {busyLikes.delete(id);}
  }
  async function openReplies(id) {
    const post=state.posts.find(item=>item.id===id)||seedPosts.find(item=>item.id===id);
    if(!post)return;
    if(!post.backendPost){openModal('<div class="tiny-label">◌ SAMPLE CONVERSATION</div><h2>Just a preview for now.</h2><p>This story and its reply count are part of the illustrated demo. Start a real conversation under a post from a Ducktown account.</p>');return;}
    openModal(`<div class="tiny-label">◌ THE CONVERSATION</div><h2>Replies</h2><p>Neighbors can respond to this post. Replies are written by people, not by robots.</p><div class="replies-list" data-replies-for="${escapeHtml(id)}" aria-live="polite">Loading replies…</div>${state.authUser?`<form id="reply-form" data-post-id="${escapeHtml(id)}"><label class="perch-note" for="reply-text">Add your reply</label><textarea id="reply-text" class="modal-input" name="message" maxlength="400" placeholder="Share a thought with the flock" required></textarea><p id="reply-error" class="perch-note" role="alert"></p><button class="button button-dark" type="submit">Post reply →</button></form>`:'<button class="button button-outline" data-action="reply-signin">Sign in to reply ↗</button>'}`);
    try {
      const response=await fetch(`/api/v1/posts/${encodeURIComponent(id)}/replies`);
      const data=await response.json();if(!response.ok)throw new Error(data.error||'Replies unavailable');
      const list=modalRoot.querySelector('.replies-list');if(list?.dataset.repliesFor!==id)return;
      list.innerHTML=data.replies.length?data.replies.map(reply=>`<article class="reply-item"><strong>@${escapeHtml(reply.handle)}</strong><small>${escapeHtml(new Date(reply.createdAt).toLocaleString())} · from a person</small><p>${escapeHtml(reply.text).replace(/\n/g,'<br>')}</p></article>`).join(''):'<p class="perch-note">No replies yet. You could be the first.</p>';
    } catch {const list=modalRoot.querySelector('.replies-list');if(list?.dataset.repliesFor===id)list.textContent='Replies could not be loaded. Please try again.';}
  }
  function openShareReceipt(id) {
    const receipt=state.privateReceipts.find(item=>item.id===id&&!item.publishedPostId);
    if(!receipt||!state.authUser)return;
    openModal(`<div class="tiny-label">◉ YOUR CHOICE</div><h2>Share this simulator moment?</h2><p>The Pond will say that <strong>${escapeHtml(friendlyName(receipt.skill))}</strong> started in the simulator and returned to a standing pose. It will also say we cannot confirm who controlled the simulator or whether the task succeeded.</p><div class="share-review"><span>People will see</span><strong>Move name, how long it was seen, snapshot count, and the limits of what we know</strong><span>Only you keep</span><strong>The full simulator data and local file</strong></div><details class="tech-details"><summary>Technical details</summary><p>A public evidence fingerprint is included so the summary can be traced back to its source. It is not independent proof of success.</p></details><p class="perch-note">No physical robot was tested. Nothing is shared until you choose the button below.</p><p id="share-error" class="perch-note" role="alert"></p><button class="button button-dark" data-action="confirm-share-receipt" data-id="${escapeHtml(id)}">Share this moment →</button>`);
  }
  function openReceiptEvidence(id) {
    const evidence=state.posts.find(post=>post.id===id)?.evidence;
    if(!evidence)return;
    openModal(`<div class="tiny-label">◉ SIMULATOR MOMENT</div><h2>${escapeHtml(friendlyName(evidence.skill))}</h2><p>The simulator showed this move starting and returning to stand. That does not prove the task succeeded, and it says nothing about a physical robot.</p>${renderTimeline(evidence.timeline)}<div class="share-review"><span>What we saw</span><strong>${escapeHtml(evidence.observedSeconds)} seconds · ${escapeHtml(evidence.frameCount)} snapshots</strong><span>Who controlled it?</span><strong>Not confirmed. A local operator linked it to this account.</strong><span>Result</span><strong>No score or completed-task claim</strong></div><details class="tech-details"><summary>Technical details</summary><p>These fingerprints identify the data used for the summary. They are not independent proof.</p><p class="receipt-hash">Trace SHA-256 <code>${escapeHtml(evidence.traceSha256)}</code></p><p class="receipt-hash">Policy SHA-256 <code>${escapeHtml(evidence.policySha256)}</code></p><p class="receipt-hash">Scene SHA-256 <code>${escapeHtml(evidence.sceneSha256)}</code></p></details>`);
  }
  async function publishReceipt(id) {
    const button=modalRoot.querySelector('[data-action="confirm-share-receipt"]');
    if(!button||!state.privateReceipts.some(item=>item.id===id&&!item.publishedPostId))return;
    button.disabled=true;
    try {
      const response=await fetch(`/api/v1/receipts/${encodeURIComponent(id)}/share`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error||'Could not share receipt');
      state.privateReceipts=state.privateReceipts.map(item=>item.id===id?result.receipt:item);
      state.posts.push(apiPost(result.post));
      closeModal();navigate('pond');showToast('Your simulator moment is now in the Pond.');
    } catch(error) {
      const target=modalRoot.querySelector('#share-error');
      if(target)target.textContent=error.message;
      button.disabled=false;
    }
  }
  function openAuth(mode='login',purpose='share') {
    const registering=mode==='register';
    openModal(`<div class="tiny-label">⚑ YOUR DUCKTOWN ACCOUNT</div><h2>${registering?'Make yourself at home':'Welcome back'}</h2><p>${registering?'Create an account and a duck profile for this local preview. No physical robot will be connected.':purpose==='inspect'?'Sign in to see what your local simulator has available. We will not start a move.':'Sign in to share a note. You can still explore the Pond without an account.'}</p><form id="auth-form" data-mode="${mode}"><label class="perch-note" for="auth-handle">Your name in town</label><input id="auth-handle" class="modal-input" name="handle" autocomplete="username" pattern="[A-Za-z][A-Za-z0-9_]{2,23}" minlength="3" maxlength="24" placeholder="Choose a handle" required><label class="perch-note" for="auth-password">Password · at least 12 characters</label><input id="auth-password" class="modal-input" name="password" type="password" autocomplete="${registering?'new-password':'current-password'}" minlength="12" maxlength="128" required><p id="auth-error" role="alert" class="perch-note"></p><button class="button button-dark" type="submit">${registering?'Create account':'Sign in'} →</button></form><button class="text-button" style="margin-top:16px" data-action="auth-switch" data-mode="${registering?'login':'register'}">${registering?'Already have an account? Sign in':'New here? Create an account'} ↗</button>`);
    modalRoot.querySelector('#auth-handle').focus();
  }
  function openSearch() {
    openModal(`<div class="tiny-label">⌕ EXPLORE DUCKTOWN</div><h2>Search the town</h2><label><input id="global-search" class="modal-input" type="search" placeholder="Try “bow”, “ball”, or “Pepper”" autocomplete="off"></label><div id="global-results" style="margin-top:14px"></div>`);
    modalRoot.querySelector('#global-search').focus();searchResults('');
  }
  function searchResults(query) {
    const el=modalRoot.querySelector('#global-results');if(!el)return;
    const q=query.toLowerCase().trim();const matches=behaviors.filter(b=>!q||`${b.name} ${b.description} ${b.kind}`.toLowerCase().includes(q)).slice(0,5);
    el.innerHTML=`<div class="tiny-label" style="margin-bottom:8px">BEHAVIORS</div>${matches.length?matches.map(b=>`<button data-action="behavior" data-id="${b.id}" style="display:flex;align-items:center;gap:11px;width:100%;border:0;border-top:1px solid #e7eee6;background:transparent;text-align:left;padding:11px 1px"><span class="skill-badge">${b.accent}</span><span><strong style="font-size:12px">${escapeHtml(b.name)}</strong><small style="display:block;color:#8b9b8e;font-size:9px">${escapeHtml(b.kind)} · ${escapeHtml(b.by)}</small></span><span style="margin-left:auto;color:#6f9573">↗</span></button>`).join(''):'<div class="empty-state">No behaviors found.</div>'}`;
  }
  function openRun(id) {
    const b=behaviors.find(x=>x.id===id);if(!b)return;
    openModal(`<div class="tiny-label">◉ TWO WAYS TO EXPLORE</div><h2>Where shall we go?</h2><p><strong>${escapeHtml(b.name)}</strong> is a Ducktown idea. It is not an available move in Pollen’s simulator.</p><div class="official-sim-card"><div class="tiny-label">POLLEN’S OFFICIAL SIMULATOR</div><h3>Try available moves</h3><p>Pollen’s simulator lets you try its published walking, sitting, rolling, and kicking moves. Ducktown cannot bring those results back here yet.</p><a class="button button-primary" href="https://huggingface.co/spaces/pollen-robotics/microduck-simulator" target="_blank" rel="noopener noreferrer">Open Pollen’s simulator ↗</a></div><div class="preview-divider">DUCKTOWN ANIMATION · NOT A ROBOT RUN</div><div class="sim-visual">${duckSvg('duck-graphic',b.variant)}</div><div class="progress-track"><i id="sim-progress"></i></div><div class="sim-readout" id="sim-readout">Ready when you are</div><div id="sim-result"></div><button class="button button-outline" id="sim-start" data-action="sim-start" data-id="${b.id}">Play the illustration →</button>`);
  }
  function startRun(id) {
    const b=behaviors.find(x=>x.id===id);if(!b||state.simTimer||!motionAllowed())return;
    const button=modalRoot.querySelector('#sim-start');button.disabled=true;button.textContent='Animating preview…';
    modalRoot.querySelector('.sim-visual')?.classList.add('preview-running');
    let progress=0;
    state.simTimer=setInterval(()=>{
      progress=Math.min(100,progress+10);
      const bar=modalRoot.querySelector('#sim-progress'),readout=modalRoot.querySelector('#sim-readout');
      if(!bar||!readout){clearInterval(state.simTimer);state.simTimer=null;return}
      bar.style.width=progress+'%';readout.textContent=`Animating interface · ${progress}%`;
      if(progress===100){clearInterval(state.simTimer);state.simTimer=null;
        modalRoot.querySelector('.sim-visual')?.classList.remove('preview-running');readout.textContent='Illustration complete';modalRoot.querySelector('#sim-result').innerHTML='<div class="sim-result"><strong>That was just for fun.</strong>No move ran in the simulator or on a physical robot, and nothing was shared.</div>';button.disabled=false;button.textContent='Play again →';showToast('A little moment of motion—just an illustration.');
      }
    },180);
  }
  function openReplay(id) {
    const b=behaviors.find(x=>x.id===id)||behaviors[0];
    const playing=motionAllowed();
    openModal(`<div class="tiny-label">◉ JUST AN ILLUSTRATION</div><h2>${escapeHtml(b.name)}</h2><p>This short loop shows how a future replay might feel. It is not footage of a robot or a simulator result.</p><div class="replay-scene motion-scene behavior-motion--${b.id} ${playing?'is-playing':'is-paused'}"><div class="replay-orbit"></div>${duckSvg('duck-graphic',b.variant)}<span class="replay-accent">${b.accent}</span><div class="replay-controls"><span>ILLUSTRATED LOOP · 8 SEC</span><button data-action="toggle-replay" aria-label="${playing?'Pause':'Play'} illustration" aria-pressed="${playing}" ${!motionAllowed()?'disabled title="Resume motion from the header to play"':''}>${playing?'Ⅱ':'▶'}</button></div></div><div class="receipt" style="margin-top:12px"><span class="verified">◉</span><strong>Idea preview · no result measured</strong><span>· ${escapeHtml(b.version)}</span></div><button class="button button-dark" data-action="behavior" data-id="${b.id}">Back to the idea ↗</button>`);
  }
  function connectPlan() { openModal(`<div class="tiny-label">⚑ WHAT COMES NEXT</div><h2>We’re building carefully.</h2><p>Today Ducktown can check a local simulator, show its available moves, and let you review an observation before sharing it. It cannot start a move, connect a physical duck, or install a community-made move.</p><div class="modal-meta"><span>1 · Check the simulator</span><span>2 · Make sure the move is known</span><span>3 · Review what happened</span><span>4 · Share only with your approval</span></div><p style="margin-top:16px">A simulator moment is never presented as a proven result or a physical-robot test.</p><button class="button button-dark" data-action="close-modal">Got it</button>`); }
  async function inspectSimulator(check='status') {
    const checks={status:'status',health:'ctl health --json',policies:'ctl policy list',version:'ctl version',realtime:'realtime'};
    if(!Object.hasOwn(checks,check))return;
    if(!state.backendAvailable){showToast('Open the local Ducktown app to check the simulator.');return;}
    if(!state.authUser){openAuth('login','inspect');return;}
    openModal(`<div class="tiny-label">◉ SIMULATOR CHECK</div><h2>Let’s see if it’s ready.</h2><p>This only asks the local simulator for information. Nothing will move, install, or be shared.</p><div style="display:flex;flex-wrap:wrap;gap:7px;margin:14px 0">${Object.keys(checks).map(name=>`<button class="button button-outline" style="padding:8px 10px;font-size:10px" data-action="simulator-check" data-check="${name}">${({status:'Connection',health:'Health',policies:'Moves',version:'Version',realtime:'Speed'})[name]}</button>`).join('')}</div><details class="tech-details"><summary>Technical details</summary><code>scripts/duck-sim ${checks[check]}</code></details><div id="simulator-result" class="perch-note">Checking the simulator…</div>`);
    try {
      const response=await fetch(`/api/v1/simulator/${check}`);const data=await response.json();
      const target=modalRoot.querySelector('#simulator-result');if(!target)return;
      target.innerHTML=`<strong>${data.configured?(data.ok?'The simulator is responding':'The simulator did not answer'):'The simulator is not set up yet'}</strong><p>${escapeHtml(data.reason||'We checked without starting a move.')}</p>${data.output?`<details class="tech-details"><summary>View the simulator’s reply</summary><pre style="white-space:pre-wrap;overflow:auto;max-height:250px;font-size:11px">${escapeHtml(data.output)}</pre></details>`:''}<p>No move was started. No physical robot was contacted.</p>`;
    } catch {const target=modalRoot.querySelector('#simulator-result');if(target)target.textContent='The local simulator check could not be reached.';}
  }
  async function captureSdkObservation() {
    if(!state.backendAvailable){showToast('Open the local Ducktown app first.');return;}
    if(!state.authUser){openAuth('login','inspect');return;}
    openModal('<div class="tiny-label">◉ PRIVATE CHECK</div><h2>Checking the simulator…</h2><p>We’re looking at its connection, available moves, and speed. Nothing will move, install, or be shared.</p><div id="sdk-capture-result" class="perch-note">One moment while we check…</div>');
    try {
      const response=await fetch('/api/v1/sdk-observations',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
      const data=await response.json(),target=modalRoot.querySelector('#sdk-capture-result');if(!target)return;
      if(!response.ok){target.textContent=`Nothing was saved. ${data.reason||data.error||'The check did not finish.'}`;return;}
      target.innerHTML=`<strong>Check saved for you.</strong><p>We looked at the simulator on ${escapeHtml(new Date(data.observation.observedAt).toLocaleString())}. No move was run or scored.</p>`;
      loadSdkObservations();
    } catch {const target=modalRoot.querySelector('#sdk-capture-result');if(target)target.textContent='No observation saved. The local backend could not be reached.';}
  }

  document.addEventListener('click',event=>{
    const target=event.target.closest('[data-view],[data-action],[data-feed],[data-workshop-filter]');if(!target)return;
    if(target.dataset.view){closeModal();navigate(target.dataset.view);return}
    if(target.dataset.feed){state.feedFilter=target.dataset.feed;render();return}
    if(target.dataset.workshopFilter){state.workshopFilter=target.dataset.workshopFilter;render();document.querySelector('#workshop-search')?.focus();return}
    const {action,id}=target.dataset;
    if(action==='toggle-scene'||action==='toggle-replay'){
      const scene=target.closest('.motion-scene');if(!scene||!motionAllowed())return;
      const playing=scene.classList.toggle('is-playing');scene.classList.toggle('is-paused',!playing);
      target.textContent=playing?'Ⅱ':'▶';target.setAttribute('aria-label',`${playing?'Pause':'Play'} ${action==='toggle-scene'?'Pepper motion study':'motion study'}`);target.setAttribute('aria-pressed',String(playing));
      if(action==='toggle-scene')state.motionPlaying=playing;
      else scene.dataset.manualPaused=String(!playing);
      return;
    }
    if(action==='close-modal'){closeModal();return}
    if(action==='compose'){openComposer();return}
    if(action==='auth-switch'){openAuth(target.dataset.mode);return}
    if(action==='signout'){
      fetch('/api/v1/auth/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(response=>{if(!response.ok)throw new Error('Sign-out failed');state.authUser=null;state.authRobot=null;state.sdkObservations=[];state.privateReceipts=[];state.receiptsError=null;state.installedPolicies=null;state.installedError=null;render();loadBackend();showToast('Signed out of this browser.');}).catch(()=>showToast('Could not sign out; check the local server.'));return;
    }
    if(action==='behavior'){openBehavior(id);return}
    if(action==='experience-tab'){const b=behaviors.find(x=>x.id===id);if(!b)return;modalRoot.querySelector('#experience-panel').innerHTML=experiencePanel(b,target.dataset.tab);modalRoot.querySelectorAll('.experience-tabs button').forEach(button=>{const active=button.dataset.tab===target.dataset.tab;button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active))});return}
    if(action==='run'){openRun(id);return}
    if(action==='sim-start'){startRun(id);return}
    if(action==='go-profile'){closeModal();navigate('profile');return}
    if(action==='replay'){openReplay(id);return}
    if(action==='connect'){connectPlan();return}
    if(action==='simulator-check'){inspectSimulator(target.dataset.check||'status');return}
    if(action==='refresh-installed'){loadInstalledPolicies();return}
    if(action==='capture-sdk'){captureSdkObservation();return}
    if(action==='share-receipt'){openShareReceipt(id);return}
    if(action==='confirm-share-receipt'){publishReceipt(id);return}
    if(action==='inspect-receipt'){openReceiptEvidence(id);return}
    if(action==='replies'){openReplies(id);return}
    if(action==='reply-signin'){openAuth('login','reply');return}
    if(action==='like'){togglePostLike(id);return}
    if(action==='join'){if(!state.joined.includes(id)){state.joined.push(id);persist();showToast('Saved for later. Your next idea is waiting!');}else showToast('Already saved in your challenge ideas.');render();return}
    if(action==='save'||action==='save-behavior'){const list=state.saved;const index=list.indexOf(id);if(index>=0)list.splice(index,1);else list.push(id);persist();if(action==='save-behavior'){openBehavior(id);showToast(index>=0?'Removed from Pepper’s collection.':'Saved to Pepper’s collection.')}else render();return}
    if(action==='toggle'){state.settings[id]=!state.settings[id];persist();render();showToast(`${target.getAttribute('aria-label')} ${state.settings[id]?'enabled':'disabled'} in this browser.`);return}
  });
  document.addEventListener('submit',async event=>{
    if(event.target.id==='auth-form'){
      event.preventDefault();const form=event.target,button=form.querySelector('[type="submit"]'),error=form.querySelector('#auth-error');button.disabled=true;error.textContent='';
      try {
        const response=await fetch(`/api/v1/auth/${form.dataset.mode}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({handle:form.elements.handle.value,password:form.elements.password.value})});
        const result=await response.json();if(!response.ok)throw new Error(result.error||'Could not sign in');
        state.authUser=result.user;state.authRobot=result.robot;closeModal();render();loadBackend();showToast(`Welcome, ${result.user.handle}. Your duck is simulation-only.`);
      }catch(cause){error.textContent=cause.message;button.disabled=false;}
      return;
    }
    if(event.target.id==='reply-form'){
      event.preventDefault();const form=event.target,button=form.querySelector('[type="submit"]'),error=form.querySelector('#reply-error'),id=form.dataset.postId,text=form.elements.message.value.trim();
      if(!text)return;
      button.disabled=true;error.textContent='';
      try {
        const response=await fetch(`/api/v1/posts/${encodeURIComponent(id)}/replies`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})});
        const result=await response.json();if(!response.ok)throw new Error(result.error||'Could not post reply');
        const post=state.posts.find(item=>item.id===id);if(post)post.replies++;
        render();openReplies(id);showToast('Your reply joined the conversation.');
      } catch(cause) {error.textContent=cause.message;button.disabled=false;}
      return;
    }
    if(event.target.id!=='compose-form')return;
    event.preventDefault();const text=event.target.elements.message.value.trim();if(!text)return;
    if(state.backendAvailable){
      const button=event.target.querySelector('[type="submit"]');button.disabled=true;
      try {
        const response=await fetch('/api/v1/posts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})});
        if(!response.ok)throw new Error('Unable to save note');
        const {post}=await response.json();state.posts.push(apiPost(post));
      } catch {button.disabled=false;showToast('Could not save to the local server. Your note is still in the composer.');return;}
    } else {
      const post={id:'note-'+Date.now(),name:'Pepper’s human',handle:'@pepper',avatar:'P',avatarClass:'pepper',time:'just now',room:'The Pond',kind:'owner',text:escapeHtml(text).replace(/\n/g,'<br>'),receipt:'saved in this browser · not robot evidence',likes:0,replies:0};
      state.posts.push(post);state.localPosts.push(post);persist();
    }
    closeModal();state.feedFilter='all';navigate('pond');showToast(state.backendAvailable?'Your note was saved to the local Ducktown server.':'Your note is in the browser-only demo Pond.');
  });
  document.addEventListener('input',event=>{
    if(event.target.id==='global-search')searchResults(event.target.value);
    if(event.target.id==='workshop-search'){const start=event.target.selectionStart;state.workshopSearch=event.target.value;render();const input=document.querySelector('#workshop-search');input.focus();input.setSelectionRange(start,start);}
  });
  document.querySelector('#search-trigger').addEventListener('click',openSearch);
  document.querySelector('#motion-toggle').addEventListener('click',()=>{
    if(reducedMotion.matches)return;
    state.settings.motion=!state.settings.motion;persist();updateMotionUI();
    showToast(state.settings.motion?'Motion is back on.':'All Ducktown motion is paused.');
  });
  document.querySelector('#notification-button').addEventListener('click',()=>openModal(`<div class="tiny-label">♧ YOUR NOTIFICATIONS</div><h2>A quiet moment.</h2><p>Pepper has no new notifications. Try a challenge or run a behavior to make a little news.</p><button class="button button-dark" data-view="arena">Explore challenges →</button>`));
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&state.modal){closeModal();return}
    if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){event.preventDefault();openSearch();}
  });
  window.addEventListener('hashchange',()=>{const next=location.hash.slice(1);if(names[next]&&next!==state.view){state.view=next;render();if(next==='workshop'&&state.authUser)loadInstalledPolicies();}});
  reducedMotion.addEventListener('change',updateMotionUI);
  const initial=location.hash.slice(1);if(names[initial])state.view=initial;render();loadBackend();
})();
