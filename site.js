// Breeze HR marketing site - scroll reveal, stat counters, copy
(function(){
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Scroll reveal
  var revs = [].slice.call(document.querySelectorAll('.reveal'));
  if (reduce || !('IntersectionObserver' in window)) {
    revs.forEach(function(el){ el.classList.add('in'); });
  } else {
    var io = new IntersectionObserver(function(entries){
      entries.forEach(function(e){ if(e.isIntersecting){ e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { threshold:0.14, rootMargin:'0px 0px -8% 0px' });
    revs.forEach(function(el){ io.observe(el); });
  }

  // Count-up stats (data-count, optional data-suffix / data-dec / data-prefix)
  function countUp(el){
    var to=parseFloat(el.getAttribute('data-count'))||0, dec=parseInt(el.getAttribute('data-dec')||'0',10);
    var suf=el.getAttribute('data-suffix')||'', pre=el.getAttribute('data-prefix')||'', dur=1400, t0=null;
    function fmt(v){ return pre + (dec?v.toFixed(dec):Math.round(v).toLocaleString('en-GB')) + suf; }
    if(reduce){ el.textContent=fmt(to); return; }
    function tick(now){ if(t0===null)t0=now; var p=Math.min(1,(now-t0)/dur); var e=1-Math.pow(1-p,3);
      el.textContent=fmt(to*e); if(p<1)requestAnimationFrame(tick); else el.textContent=fmt(to); }
    requestAnimationFrame(tick);
  }
  var counts=[].slice.call(document.querySelectorAll('[data-count]'));
  if(counts.length){
    if(reduce || !('IntersectionObserver' in window)){ counts.forEach(countUp); }
    else{
      var io2=new IntersectionObserver(function(es){ es.forEach(function(e){ if(e.isIntersecting){ countUp(e.target); io2.unobserve(e.target); } }); },{threshold:0.5});
      counts.forEach(function(el){ io2.observe(el); });
    }
  }

  // Hero collage: independent looping cards (chat answers, talent builds 9-box, files reconcile)
  (function(){
    var chat=document.getElementById('lvChat');
    var talent=document.getElementById('lvTalent');
    var compare=document.getElementById('lvCompare');
    // each step: {c: className, at: ms}; classes are removed at the start of every cycle
    function loop(el, steps, period){
      if(!el) return;
      var t=[];
      (function run(){
        t.forEach(clearTimeout); t=[];
        steps.forEach(function(s){ el.classList.remove(s.c); });
        steps.forEach(function(s){ t.push(setTimeout(function(){ el.classList.add(s.c); }, s.at)); });
        t.push(setTimeout(run, period));
      })();
    }
    if(reduce){
      if(chat) chat.classList.add('answered');
      if(talent) talent.classList.add('scan','built');
      if(compare) compare.classList.add('done');
      return;
    }
    loop(chat, [{c:'answered',at:1500}], 6000);
    loop(talent, [{c:'scan',at:500},{c:'built',at:2400}], 7000);
    loop(compare, [{c:'done',at:1800}], 6500);
  })();

  // Copy template
  window.copyTmpl=function(btn){
    var box=document.getElementById('tmpl'); if(!box) return;
    var text=box.innerText.replace(/\n{2,}/g,'\n\n');
    if(navigator.clipboard){ navigator.clipboard.writeText(text).then(function(){
      var o=btn.textContent; btn.textContent='Copied'; setTimeout(function(){btn.textContent=o;},1800);
    }).catch(function(){}); }
  };

  // Subtle nav shadow on scroll
  var nav=document.querySelector('.nav');
  if(nav){ window.addEventListener('scroll',function(){ nav.style.boxShadow = window.scrollY>8 ? '0 6px 20px rgba(16,32,60,.06)' : 'none'; },{passive:true}); }
})();
