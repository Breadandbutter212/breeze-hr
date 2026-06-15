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

  // Hero product collage: looping letter fill + email->tracker flow + KPI count-up
  (function(){
    var letter=document.getElementById('lvLetter'), flow=document.getElementById('lvFlow');
    var kpis=[].slice.call(document.querySelectorAll('.lv-count'));
    function kpiUp(el){
      var to=parseFloat(el.getAttribute('data-to'))||0, dec=parseInt(el.getAttribute('data-dec')||'0',10);
      var suf=el.getAttribute('data-suffix')||'', dur=1300, t0=null;
      function tick(now){ if(t0===null)t0=now; var p=Math.min(1,(now-t0)/dur); var e=1-Math.pow(1-p,3);
        el.textContent=(to*e).toFixed(dec)+suf; if(p<1)requestAnimationFrame(tick); else el.textContent=to.toFixed(dec)+suf; }
      requestAnimationFrame(tick);
    }
    if(reduce){
      if(letter) ['f1','f2','f3','f4','done'].forEach(function(s){ letter.classList.add(s); });
      if(flow) flow.classList.add('g2','g3','g4');
      kpis.forEach(function(el){ el.textContent=(parseFloat(el.getAttribute('data-to'))||0).toFixed(parseInt(el.getAttribute('data-dec')||'0',10))+(el.getAttribute('data-suffix')||''); });
      return;
    }
    kpis.forEach(function(el){ setTimeout(function(){ kpiUp(el); }, 500); });
    if(letter){
      var ls=['f1','f2','f3','f4','done'], lt=[];
      (function runLetter(){
        lt.forEach(clearTimeout); lt=[];
        ls.forEach(function(s){ letter.classList.remove(s); });
        ls.forEach(function(s,i){ lt.push(setTimeout(function(){ letter.classList.add(s); }, 900+i*1000)); });
        lt.push(setTimeout(runLetter, 9500));
      })();
    }
    if(flow){
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
