(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const modules = {
    dashboard: ["工作总览", "今天也要为一杯好咖啡认真"],
    announcements: ["首页公告", "门店最新通知与重要事项"],
    recipes: ["饮品配方", "稳定复现每一杯好味道"],
    presentation: ["出品标准", "统一堂食与外带的杯型、摆盘和交付标准"],
    cleanliness: ["日常整洁标准", "交接班与晚班清洁要求"],
    activities: ["活动档案", "记录门店活动与精彩时刻"],
    training: ["培训资料", "持续学习，和团队一起成长"],
    settings: ["系统设置", "账号信息与数据概览"]
  };
  const standardModules = ["presentation","cleanliness"];
  const editableModules = Object.keys(modules).filter((x) => !["dashboard","settings"].includes(x));
  const recipeCategoryOrder = ["经典咖啡","风味咖啡","奶茶","柠檬茶类","苏打特饮","茶","茶汤原料"];
  const previewItems = [
    {id:"preview-1",module:"training",title:"开店前准备标准",category:"工作流程",summary:"环境、设备、物料与人员状态的完整检查清单。",content:"一、环境准备\n提前开启照明与空调，确认店内温度舒适；检查桌椅、地面、吧台及洗手间清洁。\n\n二、设备检查\n依次开启净水、咖啡机、磨豆机与制冰机；确认咖啡机压力、温度正常，并完成冲煮头放水。\n\n三、物料准备\n检查咖啡豆、牛奶、糖浆、杯具及外带耗材，严格遵循先进先出原则。",published_at:new Date().toISOString()}
  ];
  let client = null, profile = null, items = [], currentModule = "dashboard", editMode = false, preview = false;

  const configured = () => {
    const c = window.APP_CONFIG || {};
    return !!(window.supabase && c.supabaseUrl && c.supabaseAnonKey && !c.supabaseUrl.includes("YOUR_"));
  };
  const escapeHtml = (v = "") => String(v).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const toast = (message) => { const el=$("#toast"); el.textContent=message; el.classList.add("show"); clearTimeout(toast.timer); toast.timer=setTimeout(()=>el.classList.remove("show"),2600); };
  const formatDate = (v) => v ? new Intl.DateTimeFormat("zh-CN",{year:"numeric",month:"short",day:"numeric"}).format(new Date(v)) : "未设置日期";
  const isAdmin = () => profile && profile.role === "admin";
  const state = (icon,title,text) => `<div class="state">${icon === "loader" ? '<i class="loader"></i>' : `<div class="state-symbol">${icon}</div>`}<div><b>${title}</b><p>${text}</p></div></div>`;

  async function boot() {
    $("#dateText").textContent = new Intl.DateTimeFormat("zh-CN",{month:"long",day:"numeric",weekday:"long"}).format(new Date());
    bind();
    if (!configured()) {
      $("#configGuide").classList.remove("hidden");
      $("#loginForm").querySelectorAll("input,button").forEach((x)=>x.disabled=true);
      return;
    }
    client = window.supabase.createClient(window.APP_CONFIG.supabaseUrl, window.APP_CONFIG.supabaseAnonKey);
    const {data:{session}} = await client.auth.getSession();
    if (session) await enter(session.user);
    client.auth.onAuthStateChange((event, session) => { if (event === "SIGNED_OUT" || !session) showAuth(); });
  }
  function bind() {
    $("#loginForm").addEventListener("submit", login);
    $("#previewBtn").addEventListener("click", () => { preview=true; profile={display_name:"预览访客",role:"staff"}; items=previewItems; showApp(); });
    $("#logoutBtn").addEventListener("click", async () => { if(client) await client.auth.signOut(); showAuth(); });
    $("#navList").addEventListener("click", (e) => { const b=e.target.closest("[data-module]"); if(b) navigate(b.dataset.module); });
    $("#searchInput").addEventListener("input", render);
    $("#categoryFilter").addEventListener("change", render);
    $("#archiveFilter").addEventListener("change", loadItems);
    $("#editToggle").addEventListener("click", () => { editMode=!editMode; $("#editToggle").textContent=editMode?"退出编辑":"编辑模式"; render(); });
    $("#addBtn").addEventListener("click", () => openEditor());
    $("#editorForm").addEventListener("submit", saveItem);
    $("#itemModule").addEventListener("change", () => applyEditorMode($("#itemModule").value));
    $("#editorClose").addEventListener("click", closeEditor);
    $("#editorCancel").addEventListener("click", closeEditor);
    $("#editorDialog").addEventListener("click", (e) => { if(e.target===$("#editorDialog")) closeEditor(); });
    $("#contentArea").addEventListener("click", cardAction);
    $("#contentArea").addEventListener("load", (e) => {
      if(e.target.matches && e.target.matches(".standard-image img")) classifyStandardImage(e.target);
    }, true);
    $("#menuBtn").addEventListener("click", openNav);
    $("#closeNav").addEventListener("click", closeNav);
    $("#mobileOverlay").addEventListener("click", closeNav);
  }
  async function login(e) {
    e.preventDefault(); $("#loginError").textContent=""; $("#loginBtn").disabled=true; $("#loginBtn").textContent="登录中…";
    const account=$("#email").value.trim(),normalized=account.toLowerCase();
    const aliases=(window.APP_CONFIG&&window.APP_CONFIG.accountAliases)||{};
    const email=account.includes("@") ? account : aliases[normalized]||`${normalized}@internal.local`;
    const {data,error}=await client.auth.signInWithPassword({email,password:$("#password").value});
    if(error){$("#loginError").textContent="登录失败："+error.message; $("#loginBtn").disabled=false; $("#loginBtn").innerHTML="安全登录 <span>→</span>";return}
    await enter(data.user);
  }
  async function enter(user) {
    const {data,error}=await client.from("profiles").select("*").eq("id",user.id).single();
    if(error || !data){ await client.auth.signOut(); $("#loginError").textContent="未找到员工资料，请联系管理员完善 profiles 记录。"; return; }
    profile=data; await loadItems(); showApp();
  }
  async function loadItems() {
    if(preview) return render();
    $("#contentArea").innerHTML=state("loader","正在读取资料","请稍候");
    let q=client.from("content_items").select("*").order("published_at",{ascending:false});
    const a=$("#archiveFilter").value;
    if(a==="active") q=q.eq("is_archived",false); else if(a==="archived") q=q.eq("is_archived",true);
    const {data,error}=await q;
    if(error){$("#contentArea").innerHTML=state("!","内容加载失败",escapeHtml(error.message)); return}
    items=data||[]; render();
  }
  function showApp() {
    $("#authView").classList.add("hidden"); $("#appView").classList.remove("hidden");
    $("#userName").textContent=profile.display_name||profile.full_name||"门店伙伴";
    $("#userRole").textContent=isAdmin()?"管理员":"员工";
    $("#userAvatar").textContent=(profile.display_name||"员").slice(0,1);
    $("#adminNav").classList.toggle("hidden",!isAdmin());
    $$(".admin-only").forEach((x)=>x.classList.toggle("hidden",!isAdmin()));
    navigate("dashboard");
  }
  function showAuth(){profile=null;items=[];preview=false;$("#appView").classList.add("hidden");$("#authView").classList.remove("hidden");$("#loginBtn").disabled=false;$("#loginBtn").innerHTML="安全登录 <span>→</span>";}
  function navigate(m) {
    if(m==="settings"&&!isAdmin()) return;
    currentModule=m; $$(".nav-item").forEach((b)=>b.classList.toggle("active",b.dataset.module===m));
    const staticPage=standardModules.includes(m);
    $("#pageTitle").textContent=modules[m][0];
    $$(".content-filter").forEach(el=>el.classList.toggle("hidden",staticPage||m==="settings"));
    $("#archiveFilter").classList.toggle("hidden",!isAdmin()||m==="settings");
    $("#editToggle").classList.toggle("hidden",!isAdmin()||m==="settings");
    $("#addBtn").classList.toggle("hidden",!isAdmin()||!editableModules.includes(m));
    closeNav(); updateCategories(); render();
  }
  function filtered() {
    const q=$("#searchInput").value.trim().toLowerCase(), cat=$("#categoryFilter").value;
    return items.filter((x)=>(currentModule==="dashboard"||x.module===currentModule)&&(!cat||x.category===cat)&&(!q||[x.title,x.summary,x.content,x.category].some((v)=>String(v||"").toLowerCase().includes(q))));
  }
  function updateCategories() {
    const old=$("#categoryFilter").value;
    let cats=[...new Set(items.filter(x=>currentModule==="dashboard"||x.module===currentModule).map(x=>x.category).filter(Boolean))];
    if(currentModule==="recipes") cats.sort((a,b)=>(recipeCategoryOrder.indexOf(a)<0?999:recipeCategoryOrder.indexOf(a))-(recipeCategoryOrder.indexOf(b)<0?999:recipeCategoryOrder.indexOf(b)));
    else cats.sort((a,b)=>a.localeCompare(b,"zh-CN"));
    $("#categoryFilter").innerHTML='<option value="">全部分类</option>'+cats.map(c=>`<option>${escapeHtml(c)}</option>`).join(""); if(cats.includes(old))$("#categoryFilter").value=old;
  }
  function render() {
    if(currentModule==="dashboard") return renderDashboard();
    if(currentModule==="settings") return renderSettings();
    if(standardModules.includes(currentModule)) return renderStandards(currentModule);
    const list=filtered(), info=modules[currentModule];
    if(currentModule==="recipes") return renderRecipes(list,info);
    if(currentModule==="training") return renderTraining(list,info);
    $("#contentArea").innerHTML=`<div class="section-head"><div><h3>${info[0]}</h3><p>${info[1]} · 共 ${list.length} 项</p></div></div>`+(list.length?`<div class="content-list">${list.map(row).join("")}</div>`:state("◇","暂无匹配内容","调整搜索或筛选条件后再试"));
  }
  function renderRecipes(list,info) {
    const byPosition=(a,b)=>{
      const aIndex=Number(a.metadata&&a.metadata.sort_index),bIndex=Number(b.metadata&&b.metadata.sort_index);
      if(Number.isFinite(aIndex)&&Number.isFinite(bIndex)&&aIndex!==bIndex)return aIndex-bIndex;
      return new Date(a.created_at||a.published_at)-new Date(b.created_at||b.published_at);
    };
    const groups=recipeCategoryOrder.map(category=>({category,items:list.filter(x=>x.category===category).sort(byPosition)})).filter(group=>group.items.length);
    const extras=[...new Set(list.map(x=>x.category).filter(category=>category&&!recipeCategoryOrder.includes(category)))].map(category=>({category,items:list.filter(x=>x.category===category).sort(byPosition)}));
    $("#contentArea").innerHTML=`<div class="section-head"><div><h3>${info[0]}</h3><p>严格按出品标准分类 · 共 ${list.length} 项</p></div></div>`+
      (list.length?[...groups,...extras].map(recipeGroup).join(""):state("◇","暂无匹配配方","调整搜索或筛选条件后再试"));
  }
  function recipeGroup(group,index) {
    const add=isAdmin()?`<button class="group-add" data-action="add-category" data-category="${escapeHtml(group.category)}">＋ 在此分类新增</button>`:"";
    return `<section class="document-group recipe-group tone-${index%7}" style="--delay:${index*45}ms"><header><div><span class="section-kicker">出品标准</span><h3>${escapeHtml(group.category)}</h3></div><div class="group-meta"><span>${group.items.length} 项</span>${add}</div></header><div class="recipe-table"><div class="recipe-table-head"><span>饮品名称</span><span>配方与制作标准</span><span></span></div>${group.items.map(recipeRow).join("")}</div></section>`;
  }
  function recipeRow(x) {
    const actions=isAdmin()&&editMode?adminActions(x,false):`<button class="text-btn" data-action="view" data-id="${x.id}">展开查看</button>`;
    return `<article class="recipe-row"><div class="recipe-name"><strong>${escapeHtml(x.title)}</strong>${x.is_archived?'<span class="status-label">已归档</span>':""}</div><div class="recipe-formula">${formatContent(x.content||x.summary)}</div><div class="row-action">${actions}</div></article>`;
  }
  function renderTraining(list,info) {
    list=list.filter(x=>!isStandardItem(x));
    const handbookOrder=["员工须知与礼仪规范","工作程序及标准","考勤及休假制度","安全制度与紧急处置","吧台、库房与卫生管理制度","吧台上下班规范"];
    const handbook=list.filter(x=>x.metadata&&x.metadata.source==="能咖空间员工手册.pdf").sort((a,b)=>handbookOrder.indexOf(a.title)-handbookOrder.indexOf(b.title));
    const supplementary=list.filter(x=>!x.metadata||x.metadata.source!=="能咖空间员工手册.pdf");
    const toc=handbook.map((x,index)=>`<tr><td>${String(index+1).padStart(2,"0")}</td><td><a href="#chapter-${x.id}">${escapeHtml(x.title)}</a></td><td>${escapeHtml(x.summary||"")}</td></tr>`).join("");
    $("#contentArea").innerHTML=`<div class="section-head document-heading"><div><span class="section-kicker">EMPLOYEE HANDBOOK</span><h3>${info[0]}</h3><p>按员工手册章节连续编排 · 共 ${list.length} 章</p></div></div>`+
      (list.length?`${handbook.length?`<section class="handbook-document"><header><span>能咖空间</span><h3>员工手册</h3><p>门店工作制度、服务流程与安全规范</p></header><table class="handbook-toc"><thead><tr><th>章节</th><th>标题</th><th>内容概要</th></tr></thead><tbody>${toc}</tbody></table>${handbook.map((x,index)=>trainingSection(x,index+1)).join("")}</section>`:""}${supplementary.length?`<section class="supplementary-training"><header><span class="section-kicker">SUPPLEMENT</span><h3>补充培训资料</h3></header>${supplementary.map(x=>trainingSection(x)).join("")}</section>`:""}`:state("◇","暂无培训资料","调整搜索或筛选条件后再试"));
  }
  function trainingSection(x,chapter) {
    const actions=isAdmin()&&editMode?`<div class="document-actions">${adminActions(x,true)}</div>`:"";
    return `<article id="chapter-${x.id}" class="training-section">${chapter?`<span class="chapter-number">第 ${chapter} 章</span>`:""}<header><div><h4>${escapeHtml(x.title)}</h4><p>${escapeHtml(x.summary||"")}</p></div>${actions}</header><div class="document-body">${formatContent(x.content||"")}</div></article>`;
  }
  function renderStandards(module) {
    const staticSections=(window.STANDARDS_DATA&&window.STANDARDS_DATA[module])||[];
    const saved=items.filter(x=>standardModuleOf(x)===module).sort((a,b)=>Number(a.metadata&&a.metadata.sort_index)-Number(b.metadata&&b.metadata.sort_index));
    const sectionNames=[...staticSections.map(x=>x.title),...saved.map(x=>x.category).filter(x=>!staticSections.some(section=>section.title===x))];
    const sections=saved.length?sectionNames.map(title=>({
      title,
      description:(staticSections.find(x=>x.title===title)||{}).description||"由管理员维护的门店标准。",
      items:saved.filter(x=>x.category===title).map(x=>({id:x.id,image:x.summary,title:x.title,text:x.content,record:x}))
    })).filter(section=>section.items.length):staticSections;
    const label=module==="presentation"?"SERVICE STANDARD":"CLEAN & READY";
    $("#contentArea").innerHTML=`<div class="section-head standards-heading"><div><span class="section-kicker">${label}</span><h3>${modules[module][0]}</h3><p>${modules[module][1]}</p></div></div>`+
      sections.map((section,index)=>`<section class="visual-standard-section"><header><div><span>${String(index+1).padStart(2,"0")}</span><h3>${escapeHtml(section.title)}</h3></div><p>${escapeHtml(section.description)}</p></header><div class="standard-gallery">${section.items.map((item,itemIndex)=>`<article class="standard-item" style="--delay:${itemIndex*35}ms"><button class="standard-image" type="button" data-image="${escapeHtml(item.image)}" aria-label="查看${escapeHtml(item.title)}大图"><img src="${encodeURI(item.image)}" alt="${escapeHtml(item.title)}" loading="lazy"></button><div><span>STANDARD ${String(itemIndex+1).padStart(2,"0")}</span><h4>${escapeHtml(item.title)}</h4><p>${escapeHtml(item.text)}</p>${item.record&&isAdmin()&&editMode?adminActions(item.record,false):""}</div></article>`).join("")}</div></section>`).join("");
    $$(".standard-image img",$("#contentArea")).forEach((image)=>{if(image.complete)classifyStandardImage(image);});
  }
  function standardModuleOf(item){return item.metadata&&item.metadata.standard_module;}
  function isStandardItem(item){return standardModules.includes(standardModuleOf(item));}
  function classifyStandardImage(image) {
    const card=image.closest(".standard-item");
    if(!card||!image.naturalWidth)return;
    card.classList.remove("is-landscape","is-portrait");
    card.classList.add(image.naturalWidth>=image.naturalHeight?"is-landscape":"is-portrait");
  }
  function formatContent(content) {
    return String(content||"").split(/\n+/).filter(Boolean).map(line=>{
      const safe=escapeHtml(line.trim());
      return /^[一二三四五六七八九十]+、/.test(line.trim())?`<h5>${safe}</h5>`:`<p>${safe}</p>`;
    }).join("");
  }
  function renderDashboard() {
    const active=items.filter(x=>!x.is_archived&&x.module!=="operations"&&!isStandardItem(x)), latest=[...active].sort((a,b)=>new Date(b.published_at||b.created_at)-new Date(a.published_at||a.created_at)).slice(0,6);
    const counts=(m)=>active.filter(x=>x.module===m).length;
    $("#contentArea").innerHTML=`<section class="hero"><div><p class="eyebrow">GOOD ${new Date().getHours()<12?"MORNING":"DAY"}</p><h1>${escapeHtml((profile&&profile.display_name)||"伙伴")}，欢迎回到能咖空间</h1><p>从标准出发，把认真融入今天的每一杯咖啡。</p></div><div class="hero-symbol">☕</div></section>
    <div class="stat-grid"><div class="stat-card"><small>最新公告</small><b>${counts("announcements")}</b></div><div class="stat-card"><small>饮品配方</small><b>${counts("recipes")}</b></div><div class="stat-card"><small>培训资料</small><b>${counts("training")}</b></div></div>
    <div class="section-head"><div><h3>最近更新</h3><p>快速了解门店知识库最新动态</p></div></div>${latest.length?`<div class="content-list">${latest.map(row).join("")}</div>`:state("☕","知识库还是空的",isAdmin()?"从添加第一条内容开始吧":"等待管理员发布内容")}`;
  }
  function renderSettings() {
    $("#contentArea").innerHTML=`<div class="section-head"><div><h3>系统信息</h3><p>当前连接与账号概览</p></div></div><div class="stat-grid"><div class="stat-card"><small>内容总数</small><b>${items.filter(x=>x.module!=="operations").length}</b></div><div class="stat-card"><small>已归档</small><b>${items.filter(x=>x.is_archived).length}</b></div><div class="stat-card"><small>当前角色</small><b style="font-size:20px">管理员</b></div></div><div class="content-list"><article class="content-row"><div><span class="row-category">账号资料</span><h3>${escapeHtml(profile.display_name||"门店管理员")}</h3><p>角色：admin<br>用户 ID：${escapeHtml(profile.id||"预览模式")}</p></div></article></div>`;
  }
  function card(x) {
    const actions=isAdmin()&&editMode?`<div class="card-actions"><button data-action="edit" data-id="${x.id}">编辑</button><button data-action="pin" data-id="${x.id}">${x.is_pinned?"取消置顶":"置顶"}</button><button data-action="archive" data-id="${x.id}">${x.is_archived?"恢复":"归档"}</button><button data-action="delete" data-id="${x.id}">删除</button></div>`:`<button data-action="view" data-id="${x.id}">查看详情 →</button>`;
    return `<article class="content-card ${x.is_pinned?"pinned":""}"><div class="card-top"><span class="tag">${escapeHtml(x.category||(modules[x.module]&&modules[x.module][0])||"内容")}</span>${x.is_pinned?'<span class="pin">◆ 置顶</span>':""}${x.is_archived?'<span class="tag archived-badge">已归档</span>':""}</div><h3>${escapeHtml(x.title)}</h3><p>${escapeHtml(x.summary||String(x.content||"").slice(0,75))}</p><div class="card-foot"><span>${formatDate(x.published_at||x.created_at)}</span>${actions}</div></article>`;
  }
  function row(x) {
    const actions=isAdmin()&&editMode?adminActions(x,true):`<button class="text-btn" data-action="view" data-id="${x.id}">查看内容</button>`;
    return `<article class="content-row"><div><span class="row-category">${escapeHtml(x.category||"内容")}</span><h3>${escapeHtml(x.title)}</h3><p>${escapeHtml(x.summary||String(x.content||"").slice(0,100))}</p></div><div class="row-action">${actions}</div></article>`;
  }
  function adminActions(x,allowPin) {
    return `<div class="card-actions"><button data-action="edit" data-id="${x.id}">编辑</button>${allowPin?`<button data-action="pin" data-id="${x.id}">${x.is_pinned?"取消置顶":"置顶"}</button>`:""}<button data-action="archive" data-id="${x.id}">${x.is_archived?"恢复":"归档"}</button><button data-action="delete" data-id="${x.id}">删除</button></div>`;
  }
  function cardAction(e) {
    const chapterLink=e.target.closest(".handbook-toc a");
    if(chapterLink){e.preventDefault();const chapter=$(chapterLink.getAttribute("href"));if(chapter){chapter.scrollIntoView({behavior:"smooth",block:"start"});history.replaceState(null,"",chapterLink.getAttribute("href"));}return}
    const image=e.target.closest("[data-image]"); if(image){showImage(image.dataset.image,image.querySelector("img").alt);return}
    const b=e.target.closest("[data-action]"); if(!b)return;
    if(b.dataset.action==="add-category") return openEditor({module:"recipes",category:b.dataset.category});
    const x=items.find(i=>String(i.id)===b.dataset.id); if(!x)return;
    if(b.dataset.action==="view") return showDetail(x);
    if(b.dataset.action==="edit") return openEditor(x);
    if(preview) return toast("预览模式不可修改内容");
    if(b.dataset.action==="delete"){if(confirm(`确定永久删除“${x.title}”吗？`)) mutateDelete(x);return}
    if(b.dataset.action==="pin") mutateUpdate(x,{is_pinned:!x.is_pinned},"更新置顶状态");
    if(b.dataset.action==="archive") mutateUpdate(x,{is_archived:!x.is_archived},x.is_archived?"恢复内容":"归档内容");
  }
  function showDetail(x){$("#detailCategory").textContent=x.category||"内容";$("#detailTitle").textContent=x.title;$("#detailMeta").textContent=`${(modules[x.module]&&modules[x.module][0])||""} · ${formatDate(x.published_at||x.created_at)}`;$("#detailContent").innerHTML=formatContent(x.content||x.summary||"");$("#detailDialog").showModal();}
  function openEditor(x={}) {
    if(preview)return toast("预览模式不可修改内容");
    $("#dialogTitle").textContent=x.id?"编辑内容":"添加内容"; $("#itemId").value=x.id||"";
    $("#itemModule").innerHTML=editableModules.map(m=>`<option value="${m}">${modules[m][0]}</option>`).join("");
    $("#itemModule").value=standardModuleOf(x)||x.module||(editableModules.includes(currentModule)?currentModule:"announcements");
    $("#itemCategory").value=x.category||"";$("#itemCategorySelect").value=recipeCategoryOrder.includes(x.category)?x.category:"经典咖啡";$("#itemTitle").value=x.title||"";$("#itemSummary").value=x.summary||"";$("#itemContent").value=x.content||"";
    $("#itemPublished").value=x.published_at?new Date(new Date(x.published_at).getTime()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16):"";
    $("#itemPinned").checked=!!x.is_pinned;$("#itemArchived").checked=!!x.is_archived;applyEditorMode($("#itemModule").value);$("#editorDialog").showModal();
  }
  function applyEditorMode(module) {
    const recipe=module==="recipes",standard=standardModules.includes(module);
    $("#itemCategory").classList.toggle("hidden",recipe);
    $("#itemCategorySelect").classList.toggle("hidden",!recipe);
    $("#itemSummaryField").classList.toggle("hidden",recipe);
    $("#itemSummaryLabel").textContent=standard?"图片路径":"摘要";
    $("#itemTitleLabel").textContent=recipe?"饮品名称":standard?"标准名称":"标题";
    $("#itemContentLabel").textContent=recipe?"配方内容":standard?"标准说明":"正文";
    $("#itemCategoryField").childNodes[0].textContent=standard?"所属分区":"分类";
    $("#itemTitle").placeholder=recipe?"输入饮品名称":standard?"输入标准名称":"输入清晰的内容标题";
    $("#itemSummary").placeholder=standard?"输入项目内图片路径，例如：出品标准/图片.jpg":"用于列表概览的简短说明";
    $("#itemContent").placeholder=recipe?"输入中杯、大杯配方及制作注意事项":standard?"输入图片对应的执行标准":"输入正文，可使用换行组织内容";
    $("#itemPinned").closest("label").classList.toggle("hidden",recipe||standard);
    if(recipe||standard) $("#itemPinned").checked=false;
  }
  function closeEditor(){if($("#editorDialog").open)$("#editorDialog").close();}
  async function saveItem(e) {
    e.preventDefault(); const id=$("#itemId").value,module=$("#itemModule").value,recipe=module==="recipes",standard=standardModules.includes(module),existing=id?items.find(i=>String(i.id)===id):null,payload={module:standard?"training":module,category:recipe?$("#itemCategorySelect").value:$("#itemCategory").value.trim(),title:$("#itemTitle").value.trim(),summary:recipe?(existing&&existing.summary||""):$("#itemSummary").value.trim(),content:$("#itemContent").value.trim(),is_pinned:recipe||standard?false:$("#itemPinned").checked,is_archived:$("#itemArchived").checked,published_at:$("#itemPublished").value?new Date($("#itemPublished").value).toISOString():(existing&&existing.published_at)||new Date().toISOString(),updated_at:new Date().toISOString()};
    if(!id)payload.created_by=profile.id;
    if(recipe&&!id){const positions=items.filter(x=>x.module==="recipes"&&x.category===payload.category).map(x=>Number(x.metadata&&x.metadata.sort_index)).filter(Number.isFinite);payload.metadata={source:"manual",sort_index:positions.length?Math.max(...positions)+1:0};}
    if(standard){const sameGroup=existing&&standardModuleOf(existing)===module&&existing.category===payload.category,positions=items.filter(x=>x.id!==(existing&&existing.id)&&standardModuleOf(x)===module&&x.category===payload.category).map(x=>Number(x.metadata&&x.metadata.sort_index)).filter(Number.isFinite);payload.metadata={...(existing&&existing.metadata||{}),standard_module:module,sort_index:sameGroup?(Number(existing.metadata&&existing.metadata.sort_index)||0):(positions.length?Math.max(...positions)+1:0)};}
    else if(existing&&isStandardItem(existing)){payload.metadata={...(existing.metadata||{})};delete payload.metadata.standard_module;delete payload.metadata.sort_index;}
    $("#saveBtn").disabled=true;$("#saveBtn").textContent="保存中…";
    const result=id?await client.from("content_items").update(payload).eq("id",id):await client.from("content_items").insert(payload);
    $("#saveBtn").disabled=false;$("#saveBtn").textContent="保存内容"; if(result.error)return toast("保存失败："+result.error.message);
    $("#editorDialog").close();await log(id?"update":"create",payload.title);toast("内容已保存");await loadItems();
  }
  function showImage(src,title){$("#detailCategory").textContent="图片标准";$("#detailTitle").textContent=title;$("#detailMeta").textContent="点击页面空白处或右上角关闭";$("#detailContent").innerHTML=`<img class="detail-image" src="${encodeURI(src)}" alt="${escapeHtml(title)}">`;$("#detailDialog").showModal();}
  async function mutateUpdate(x,patch,label){const {error}=await client.from("content_items").update({...patch,updated_at:new Date().toISOString()}).eq("id",x.id);if(error)return toast("操作失败："+error.message);await log("update",`${label}：${x.title}`);toast("操作成功");await loadItems();}
  async function mutateDelete(x){const {error}=await client.from("content_items").delete().eq("id",x.id);if(error)return toast("删除失败："+error.message);await log("delete",x.title);toast("内容已删除");await loadItems();}
  async function log(action,detail){if(!client||preview)return;try{await client.from("activity_logs").insert({user_id:profile.id,action,details:{detail}})}catch(_){}}
  function openNav(){$("#sidebar").classList.add("open");$("#mobileOverlay").classList.add("show")}
  function closeNav(){$("#sidebar").classList.remove("open");$("#mobileOverlay").classList.remove("show")}
  boot().catch((e)=>{$("#loginError").textContent="初始化失败："+e.message});
})();
