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

  // Hero collage: the 3 animated cards play in sequence (1 -> 2 -> 3), then the chain restarts
  (function(){
    var chat=document.getElementById('lvChat');
    var talent=document.getElementById('lvTalent');
    var compare=document.getElementById('lvCompare');
    if(reduce){
      if(chat) chat.classList.add('answered');
      if(talent) talent.classList.add('scan','built');
      if(compare) compare.classList.add('done');
      return;
    }
    var t=[];
    (function chain(){
      t.forEach(clearTimeout); t=[];
      if(chat) chat.classList.remove('answered');
      if(talent) talent.classList.remove('scan','built');
      if(compare) compare.classList.remove('done');
      // 1) AI assistant answers
      if(chat) t.push(setTimeout(function(){ chat.classList.add('answered'); }, 900));
      // 2) Talent: upload, then build the 9-box
      if(talent){ t.push(setTimeout(function(){ talent.classList.add('scan'); }, 3300));
                  t.push(setTimeout(function(){ talent.classList.add('built'); }, 5000)); }
      // 3) Reconcile surfaces the mismatches
      if(compare) t.push(setTimeout(function(){ compare.classList.add('done'); }, 7700));
      // hold, then restart the chain
      t.push(setTimeout(chain, 12000));
    })();
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

  // Hero "automated" scene (lifted from the app sign-in)
  (function(){
    var letter=document.getElementById('lvLetter');
    if(letter){
      var steps=['f1','f2','f3','f4','done'];
      if(reduce){ steps.forEach(function(s){ letter.classList.add(s); }); }
      else{
        var lt=[];
        (function run(){
          lt.forEach(clearTimeout); lt=[];
          steps.forEach(function(s){ letter.classList.remove(s); });
          steps.forEach(function(s,i){ lt.push(setTimeout(function(){ letter.classList.add(s); }, 900+i*1000)); });
          lt.push(setTimeout(run, 9500));
        })();
      }
    }
    var flow=document.getElementById('lvFlow');
    if(flow){
      if(reduce){ flow.classList.add('g2','g3','g4'); }
      else{
        var fs=['g1','g2','g3','g4'], ft=[];
        (function runFlow(){
          ft.forEach(clearTimeout); ft=[];
          fs.forEach(function(s){ flow.classList.remove(s); });
          ft.push(setTimeout(function(){ flow.classList.add('g1'); }, 500));
          ft.push(setTimeout(function(){ flow.classList.add('g2'); }, 2000));
          ft.push(setTimeout(function(){ flow.classList.add('g3'); }, 3600));
          ft.push(setTimeout(function(){ flow.classList.add('g4'); }, 4600));
          ft.push(setTimeout(runFlow, 9500));
        })();
      }
    }
    var lvCounts=[].slice.call(document.querySelectorAll('.lv-count'));
    function lvCountUp(el){
      var to=parseFloat(el.getAttribute('data-to'))||0, dec=parseInt(el.getAttribute('data-dec')||'0',10);
      var suf=el.getAttribute('data-suffix')||'', dur=1300, t0=null;
      if(reduce){ el.textContent=to.toFixed(dec)+suf; return; }
      function tick(now){ if(t0===null)t0=now; var p=Math.min(1,(now-t0)/dur); var e=1-Math.pow(1-p,3);
        el.textContent=(to*e).toFixed(dec)+suf; if(p<1)requestAnimationFrame(tick); else el.textContent=to.toFixed(dec)+suf; }
      requestAnimationFrame(tick);
    }
    if(lvCounts.length){
      if(reduce || !('IntersectionObserver' in window)){ lvCounts.forEach(lvCountUp); }
      else{
        var io3=new IntersectionObserver(function(es){ es.forEach(function(e){ if(e.isIntersecting){ lvCountUp(e.target); io3.unobserve(e.target); } }); },{threshold:.4});
        lvCounts.forEach(function(el){ io3.observe(el); });
      }
    }
  })();
})();
