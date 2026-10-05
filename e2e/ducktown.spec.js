import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('guest can browse Pond and Workshop without overflow or browser errors',async({page})=>{
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/#pond');
  await expect(page.getByRole('heading',{name:'Small robots. Remarkable stories.'})).toBeVisible();
  await expect(page.getByRole('heading',{name:/From the flock/})).toBeVisible();
  await page.locator('[data-view="workshop"]:visible').first().click();
  await expect(page.getByRole('heading',{name:'Teach a duck something new.'})).toBeVisible();
  await page.getByRole('button',{name:'Sign in to look'}).click();
  const dialog=page.getByRole('dialog');
  await expect(dialog).toContainText('Sign in to see what your local simulator has available');
  await expect(dialog.getByRole('textbox',{name:'Your name in town'})).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  const dimensions=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
  expect(errors).toEqual([]);
});

test('signup and a Pond note persist in the isolated browser-test database',async({page},testInfo)=>{
  test.setTimeout(60000);
  const handle=`e2e_${testInfo.project.name}`;
  await page.goto('/#pond');
  await page.getByRole('button',{name:'Sign in to share'}).click();
  await page.getByRole('button',{name:'New here? Create an account'}).click();
  await page.getByRole('textbox',{name:'Your name in town'}).fill(handle);
  await page.getByRole('textbox',{name:/Password/}).fill('browser-test-password-123');
  await page.getByRole('button',{name:'Create account'}).click();
  await expect(page.getByRole('heading',{name:'Your recovery code.'})).toBeVisible();
  await page.getByRole('button',{name:'I’ve saved the code'}).click();
  await expect(page.getByRole('heading',{name:new RegExp(`Introduce ${handle}`)})).toBeVisible();
  await page.getByRole('button',{name:'Close'}).click();
  await page.goto('/#pond');
  await page.locator('[data-action="compose"]:visible').first().click();
  await page.locator('#compose-form textarea').fill(`A browser-tested note from ${handle}`);
  await page.getByRole('button',{name:'Share with the Pond'}).click();
  await expect(page.getByText(`A browser-tested note from ${handle}`)).toBeVisible();
  await expect.poll(async()=>{
    const response=await page.request.get('/api/v1/posts');
    return (await response.json()).posts.some(post=>post.text===`A browser-tested note from ${handle}`);
  }).toBe(true);
  await page.reload();
  await expect(page.getByText(`A browser-tested note from ${handle}`)).toBeVisible({timeout:15000});
});

test('Pond and sign-in dialog have no serious automated accessibility violations',async({page})=>{
  test.setTimeout(60000);
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto('/#pond');
  const tags=['wcag2a','wcag2aa','wcag21a','wcag21aa'];
  const pond=await new AxeBuilder({page}).withTags(tags).analyze();
  const serious=result=>result.violations.filter(item=>['critical','serious'].includes(item.impact)).map(item=>({id:item.id,impact:item.impact,nodes:item.nodes.map(node=>({target:node.target[0],ratio:node.any[0]?.data?.contrastRatio,colors:[node.any[0]?.data?.fgColor,node.any[0]?.data?.bgColor]}))}));
  expect(serious(pond)).toEqual([]);
  await page.getByRole('button',{name:'Sign in to share'}).click();
  const dialog=await new AxeBuilder({page}).include('#modal-root').withTags(tags).analyze();
  expect(serious(dialog)).toEqual([]);
});

test('every town view fits small phones and keeps navigation usable',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='mobile','Mobile viewport audit');
  test.setTimeout(90000);
  await page.emulateMedia({reducedMotion:'reduce'});
  // The 3D bundle is exercised in the browsing journey; keep this repeated
  // viewport sweep focused on layout, including the built-in SVG fallback.
  await page.route('**/assets/microduck-3d-*.js',route=>route.abort());
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  for(const width of [320,390]){
    await page.setViewportSize({width,height:700});
    for(const [route,heading] of [
      ['pond','Small robots. Remarkable stories.'],
      ['workshop','Teach a duck something new.'],
      ['arena','Make something delightful.'],
      ['map','Find your place in town.'],
      ['profile',/Every duck has a story\.|Your duck, your story\.|Meet .+\./],
      ['perch','The Human Perch.']
    ]){
      await page.goto(`/#${route}`);
      await expect(page.locator('.pond-heading,.page-head').getByRole('heading',{name:heading})).toBeVisible();
      await expect(page.getByRole('navigation',{name:'Mobile navigation'})).toBeVisible();
      const layout=await page.evaluate(()=>({
        viewport:innerWidth,
        document:document.documentElement.scrollWidth,
        offenders:[...document.querySelectorAll('body *')].filter(element=>{
          const box=element.getBoundingClientRect();
          return getComputedStyle(element).position!=='absolute'&&box.width>0&&(box.right>innerWidth+1||box.left< -1);
        }).slice(0,8).map(element=>({tag:element.tagName,className:String(element.className).slice(0,80)}))
      }));
      expect(layout.document,`${width}px ${route}: ${JSON.stringify(layout.offenders)}`).toBeLessThanOrEqual(layout.viewport);
      const navButtons=page.getByRole('navigation',{name:'Mobile navigation'}).getByRole('button');
      await expect(navButtons).toHaveCount(6);
      for(const button of await navButtons.all()){
        const box=await button.boundingBox();
        expect(box?.width).toBeGreaterThanOrEqual(44);
      }
    }
  }
  await page.getByRole('navigation',{name:'Mobile navigation'}).getByRole('button',{name:'You'}).click();
  await expect(page.getByRole('heading',{name:'The Human Perch.'})).toBeVisible();
  expect(errors).toEqual([]);
});

test('demo profile keeps its title readable and robot separate on phones',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='mobile','Mobile profile layout');
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.route('**/assets/microduck-3d-*.js',route=>route.abort());
  for(const width of [320,390,600]){
    await page.setViewportSize({width,height:800});
    await page.goto('/#profile');
    const layout=await page.evaluate(()=>{
      const hero=document.querySelector('.profile-hero');
      const copy=hero.querySelector('.profile-copy');
      const title=copy.querySelector('h1');
      const robot=hero.querySelector('.duck-render');
      const rect=element=>{
        const {top,right,bottom,left}=element.getBoundingClientRect();
        return {top,right,bottom,left};
      };
      return {
        hero:rect(hero),copy:rect(copy),title:rect(title),robot:rect(robot),
        titleLines:title.getBoundingClientRect().height/parseFloat(getComputedStyle(title).lineHeight),
        titleOverflows:title.scrollWidth>title.clientWidth
      };
    });
    expect(layout.titleOverflows,`${width}px title overflows`).toBe(false);
    // The shared test database may contain a longer member name from signup tests.
    expect(layout.titleLines,`${width}px title wraps excessively`).toBeLessThan(3.1);
    expect(layout.copy.right-layout.copy.left,`${width}px copy is squeezed`).toBeGreaterThanOrEqual(layout.hero.right-layout.hero.left-1);
    expect(layout.copy.right,`${width}px copy leaves card`).toBeLessThanOrEqual(layout.hero.right+1);
    expect(layout.robot.top,`${width}px robot overlaps copy`).toBeGreaterThanOrEqual(layout.copy.bottom-1);
    expect(layout.robot.bottom,`${width}px robot leaves card`).toBeLessThanOrEqual(layout.hero.bottom+1);
  }
});

test('mobile town views have no serious automated accessibility violations',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='mobile','Mobile accessibility audit');
  test.setTimeout(90000);
  await page.emulateMedia({reducedMotion:'reduce'});
  const tags=['wcag2a','wcag2aa','wcag21a','wcag21aa'];
  const findings=[];
  for(const route of ['pond','workshop','arena','map','profile','perch']){
    await page.goto(`/#${route}`);
    const results=await new AxeBuilder({page}).withTags(tags).analyze();
    const serious=results.violations.filter(item=>['critical','serious'].includes(item.impact)).map(item=>({
      id:item.id,
      nodes:item.nodes.map(node=>({target:node.target[0],ratio:node.any[0]?.data?.contrastRatio}))
    }));
    if(serious.length)findings.push({route,serious});
  }
  expect(findings).toEqual([]);
});
