(()=>{
  const registry=new Map();
  let opened=null,openKey='';
  const keyOf=(select)=>select.id?`id:${select.id}`:select.name?`name:${select.name}`:'';
  const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
  const isMulti=(select)=>!!(select?.multiple||select?.dataset?.multiSelect==='1');
  const chosen=(select)=>[...select.options].filter(o=>o.value!==''&&o.selected);
  function close(root,{clearKey=true}={}){
    if(!root)return;
    root.classList.remove('open');
    root.querySelector('.persistent-select-trigger')?.setAttribute('aria-expanded','false');
    if(opened===root)opened=null;
    if(clearKey)openKey='';
  }
  function position(root){
    if(!root?.isConnected||!root.classList.contains('open'))return;
    const trigger=root.querySelector('.persistent-select-trigger'),panel=root.querySelector('.persistent-select-panel');
    if(!trigger||!panel)return;
    const r=trigger.getBoundingClientRect(),vw=Math.max(document.documentElement.clientWidth||0,window.innerWidth||0),vh=Math.max(document.documentElement.clientHeight||0,window.innerHeight||0);
    const desired=Math.min(820,Math.max(r.width,420),Math.max(280,vw-24));
    panel.style.width=`${desired}px`;
    panel.style.left=`${clamp(r.left,12,Math.max(12,vw-desired-12))}px`;
    panel.style.maxHeight=`${Math.max(240,Math.min(620,vh-32))}px`;
    const below=vh-r.bottom,above=r.top;
    if(below>=Math.min(360,above)){panel.style.top=`${Math.min(vh-12,r.bottom+6)}px`;panel.style.bottom='auto';}
    else{panel.style.top='auto';panel.style.bottom=`${Math.max(12,vh-r.top+6)}px`;}
  }
  function selectedText(select){
    if(isMulti(select)){
      const list=chosen(select);
      if(!list.length)return 'ทั้งหมด';
      if(list.length===1)return String(list[0].textContent||list[0].value);
      return `${list.length} รายการที่เลือก`;
    }
    return String(select.selectedOptions?.[0]?.textContent||select.options?.[select.selectedIndex]?.textContent||'เลือก');
  }
  function applyChoice(select,option){
    if(!isMulti(select)){select.value=option.value;return;}
    const empty=[...select.options].find(o=>o.value==='');
    if(option.value===''){
      for(const o of select.options)o.selected=false;
      if(empty)empty.selected=true;
      return;
    }
    if(empty)empty.selected=false;
    option.selected=!option.selected;
    if(!chosen(select).length&&empty)empty.selected=true;
  }
  function sync(root,select){
    const trigger=root.querySelector('.persistent-select-trigger'),list=root.querySelector('.persistent-select-options'),head=root.querySelector('.persistent-select-head strong');
    if(!trigger||!list)return;
    const multi=isMulti(select),label=selectedText(select)||'ทั้งหมด';
    root.classList.toggle('multi',multi);
    if(head)head.textContent=multi?'เลือกได้หลายรายการ':'เลือกข้อมูล';
    trigger.querySelector('span').textContent=label;
    trigger.title=label;
    trigger.disabled=select.disabled;
    const selected=chosen(select);
    const frag=document.createDocumentFragment();
    for(const option of select.options){
      const active=multi?(option.value===''?selected.length===0:option.selected):option.value===select.value;
      const b=document.createElement('button');
      b.type='button';b.className='persistent-select-option';b.dataset.value=option.value;b.title=String(option.textContent||option.value);b.disabled=option.disabled;b.setAttribute('role','option');b.setAttribute('aria-selected',String(active));
      if(multi){const check=document.createElement('input');check.type='checkbox';check.tabIndex=-1;check.checked=active;check.setAttribute('aria-hidden','true');const span=document.createElement('span');span.textContent=String(option.textContent||option.value);b.append(check,span);}else b.textContent=String(option.textContent||option.value);
      b.addEventListener('click',(e)=>{
        e.preventDefault();e.stopPropagation();applyChoice(select,option);select.dispatchEvent(new Event('change',{bubbles:true}));sync(root,select);
        openKey=keyOf(select);
        queueMicrotask(()=>{
          const replacement=[...registry.keys()].find(s=>keyOf(s)===openKey&&s.isConnected),replacementRoot=replacement&&registry.get(replacement);
          if(replacementRoot){if(opened&&opened!==replacementRoot)close(opened,{clearKey:false});opened=replacementRoot;replacementRoot.classList.add('open');replacementRoot.querySelector('.persistent-select-trigger')?.setAttribute('aria-expanded','true');position(replacementRoot);}
        });
      });
      frag.appendChild(b);
    }
    list.replaceChildren(frag);
    if(root.classList.contains('open'))position(root);
  }
  function open(root,select){if(opened&&opened!==root)close(opened,{clearKey:false});opened=root;openKey=keyOf(select);root.classList.add('open');root.querySelector('.persistent-select-trigger')?.setAttribute('aria-expanded','true');sync(root,select);position(root);}
  function enhance(select){
    if(!select||registry.has(select)||select.dataset.persistentSelect==='1')return;
    select.dataset.persistentSelect='1';select.classList.add('persistent-native');
    const root=document.createElement('div');root.className='persistent-select';root.innerHTML='<button type="button" class="persistent-select-trigger" aria-haspopup="listbox" aria-expanded="false"><span></span><i aria-hidden="true">▾</i></button><div class="persistent-select-panel" role="dialog"><div class="persistent-select-head"><strong>เลือกข้อมูล</strong><button type="button" class="persistent-select-close">ปิด</button></div><div class="persistent-select-options" role="listbox"></div></div>';
    select.insertAdjacentElement('afterend',root);registry.set(select,root);
    const trigger=root.querySelector('.persistent-select-trigger');trigger.addEventListener('click',(e)=>{e.preventDefault();e.stopPropagation();if(root.classList.contains('open'))close(root);else open(root,select);});
    root.querySelector('.persistent-select-close').addEventListener('click',(e)=>{e.preventDefault();e.stopPropagation();close(root);});
    select.addEventListener('change',()=>sync(root,select));
    new MutationObserver(()=>sync(root,select)).observe(select,{childList:true,subtree:true,attributes:true});
    sync(root,select);if(openKey&&keyOf(select)===openKey)queueMicrotask(()=>open(root,select));
  }
  function scan(scope=document){scope.querySelectorAll?.('select').forEach(enhance);}
  function syncAll(){for(const [select,root] of registry){if(select.isConnected)sync(root,select);}}
  function init(){scan(document);new MutationObserver((records)=>{for(const record of records)for(const node of record.addedNodes){if(node.nodeType!==1)continue;if(node.matches?.('select'))enhance(node);scan(node);}if(opened&&!opened.isConnected)opened=null;}).observe(document.body,{childList:true,subtree:true});}
  document.addEventListener('click',(e)=>{if(opened&&!opened.contains(e.target))close(opened);});
  document.addEventListener('keydown',(e)=>{if(e.key==='Escape'&&opened)close(opened);});
  window.addEventListener('resize',()=>position(opened));window.addEventListener('scroll',()=>position(opened),true);window.addEventListener('ms-select-sync',syncAll);
  window.MSPersistentSelect={init,syncAll,closeCurrent:()=>close(opened)};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
