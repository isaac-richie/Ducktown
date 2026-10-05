import { test, expect } from '@playwright/test';

test('robot controls preserve appearance, pause motion, and honor reduced motion',async({page})=>{
  test.setTimeout(60000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/#pond');
  const robot=page.locator('.featured-stage microduck-view');
  await expect(robot).toHaveAttribute('data-renderer','webgl',{timeout:20000});
  // Phones keep colours and camera views in a sheet behind the ⋯ button.
  const more=page.getByRole('button',{name:'More robot controls'});
  if(await more.isVisible())await more.click();
  await page.getByRole('button',{name:'Sky shell',exact:true}).click();
  await expect(robot).toHaveAttribute('data-variant','sky');
  await page.getByRole('button',{name:'Camera views',exact:true}).click();
  await page.getByRole('button',{name:'Front robot view',exact:true}).click();
  // Picking a view closes the camera menu; the choice is still recorded on the (now hidden) button.
  await expect(page.getByRole('button',{name:'Front robot view',exact:true,includeHidden:true})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'Pause all motion',exact:true}).click();
  const paused=await robot.getAttribute('data-pose-time');
  await page.waitForTimeout(250);
  expect(await robot.getAttribute('data-pose-time')).toBe(paused);
  await page.emulateMedia({reducedMotion:'reduce'});
  await expect(page.locator('#motion-toggle')).toBeDisabled();
  expect(errors).toEqual([]);
});

test('two people can create profiles, share a note, and reply in separate sessions',async({browser},testInfo)=>{
  test.setTimeout(60000);
  const {viewport,isMobile,hasTouch}=testInfo.project.use;
  const contexts=await Promise.all([browser.newContext({viewport,isMobile,hasTouch}),browser.newContext({viewport,isMobile,hasTouch})]);
  const base='http://127.0.0.1:8790';
  const suffix=`${testInfo.project.name}_${Date.now().toString(36)}`;
  try {
    const pages=[];
    for(const [i,context] of contexts.entries()){
      const response=await context.request.post(`${base}/api/v1/auth/register`,{data:{handle:`p${i}_${suffix}`,password:'presentation-rehearsal-123'}});
      expect(response.status()).toBe(201);
      const profile=await context.request.put(`${base}/api/v1/profile`,{data:{name:i?'Pip':'Pepper',bio:'Building a little robot together.',colorway:i?'lavender':'cream',publicProfile:true}});
      expect(profile.ok()).toBe(true);
      const page=await context.newPage();
      await page.emulateMedia({reducedMotion:'reduce'});
      await page.goto(`${base}/#pond`);
      await expect(page.locator('.user-chip')).toHaveAttribute('aria-label',`Open @p${i}_${suffix} account controls`);
      pages.push(page);
    }
    const [author,neighbor]=pages;
    const note=`Our first shared build story ${suffix}`;
    await author.locator('[data-action="compose"]:visible').first().click();
    await author.locator('#compose-form textarea').fill(note);
    await author.getByRole('button',{name:'Share with the Pond'}).click();
    await expect(author.getByText(note,{exact:true})).toBeVisible();
    await neighbor.reload();
    const card=neighbor.locator('.feed-card').filter({hasText:note});
    await expect(card).toBeVisible();
    await card.getByRole('button',{name:/replies/}).click();
    await neighbor.locator('#reply-text').fill('I can see your update. Let’s build this together.');
    await neighbor.getByRole('button',{name:'Post reply'}).click();
    await expect(neighbor.getByRole('dialog')).toContainText('Let’s build this together.');
    await author.reload();
    await author.locator('.feed-card').filter({hasText:note}).getByRole('button',{name:/1 replies/}).click();
    await expect(author.getByRole('dialog')).toContainText('Let’s build this together.');
  } finally {await Promise.all(contexts.map(context=>context.close()));}
});
