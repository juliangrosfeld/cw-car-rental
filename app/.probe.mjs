import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/home/juliangrosfeld/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome' });
const p = await (await b.newContext({ viewport:{width:1280,height:800} })).newPage();
await p.goto('http://localhost:5199/', { waitUntil:'networkidle' });
await p.waitForTimeout(1200);
try {
  await p.locator('header a[href="/booking"]').first().click({ timeout: 4000 });
  console.log('real click OK ->', p.url());
} catch(e) {
  console.log('=== CLICK ERROR (full log) ===');
  console.log(e.message);
}
// Also: manually hit-test at several points across the button, mimicking playwright sampling
const scan = await p.evaluate(()=>{
  const cta = document.querySelector('header a[href="/booking"]');
  const r = cta.getBoundingClientRect();
  const pts = [[0.5,0.5],[0.2,0.5],[0.8,0.5],[0.5,0.2],[0.5,0.8]];
  return pts.map(([fx,fy])=>{
    const x=Math.round(r.x+r.width*fx), y=Math.round(r.y+r.height*fy);
    const el=document.elementFromPoint(x,y);
    return {x,y, hit: el? (el.tagName+'.'+((el.className.baseVal!==undefined?el.className.baseVal:el.className)||'').toString().split(' ').slice(0,2).join('.')) : null, inCta: cta.contains(el)||cta===el};
  });
});
console.log('point scan:', JSON.stringify(scan,null,0));
await b.close();
