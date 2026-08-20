import { expect, Page, test as base } from '@playwright/test';

/**
 * One person signs in and sees the plan.
 *
 * That sentence is the whole test, and every production defect this project
 * has had would have failed it: a redirect URI the realm did not accept, a
 * service holding the development API address because it was built before
 * config.json arrived, a content security policy correctly refusing the
 * request that address produced. None of them broke a unit test, none of them
 * broke an integration test, and none of them left anything in a server log,
 * because the request never reached a server.
 */

/** Published in the README on purpose; overridable for an instance that is not the demo. */
const PASSWORD = process.env['E2E_PASSWORD'] ?? 'demo';

const PROJECT = 'Storefront Relaunch';
const TASKS = 15;

/**
 * Everything the browser complains about, collected rather than ignored.
 *
 * The failure mode this exists for is silent: a blocked request leaves the
 * screen looking merely empty, and an empty screen is what an application
 * with no data legitimately looks like. Asserting on this list is what turns
 * "nothing is here" into "something refused to load, and here is what".
 */
function watchForBreakage(page: Page): string[] {
  const problems: string[] = [];

  page.on('console', message => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`);
  });
  page.on('pageerror', error => problems.push(`uncaught: ${error.message}`));
  page.on('requestfailed', request => {
    const why = request.failure()?.errorText ?? '';

    // An abort is the client's own decision, not a refusal: switching project
    // or view cancels the request in flight for the one being left, and the
    // polling request is cancelled the same way. A request the browser
    // refused to make reports something else — and a content security policy
    // says so in the console as well, which is caught above.
    if (why.includes('ERR_ABORTED')) return;

    problems.push(`blocked: ${request.method()} ${request.url()} — ${why}`);
  });
  page.on('response', response => {
    if (response.url().includes('/api/v1/') && response.status() >= 400) {
      problems.push(`api: ${response.status()} ${response.request().method()} ${response.url()}`);
    }
  });

  return problems;
}

/**
 * The list, attached to whatever fails.
 *
 * A test that dies on a missing element reports a missing element, which is
 * the symptom and never the cause: the element is missing because a request
 * was refused three seconds earlier. Collecting the refusals is only half the
 * job; the other half is making sure they are in the report even when the
 * assertion that reads them is never reached.
 */
const test = base.extend<{ problems: string[] }>({
  problems: async ({ page }, use, testInfo) => {
    const problems = watchForBreakage(page);

    await use(problems);

    if (testInfo.status !== testInfo.expectedStatus && problems.length) {
      const report = problems.join('\n');

      // Attached for the HTML report, and printed for the person watching the
      // terminal: an attachment they have to open a report to read is not
      // where anybody looks first.
      await testInfo.attach('what the browser complained about', {
        body: report,
        contentType: 'text/plain',
      });
      console.log(`\nwhat the browser complained about:\n${report}\n`);
    }
  },
});

async function signIn(page: Page, username: string): Promise<void> {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: /Plan the work/ })).toBeVisible();

  // Present on a public instance and absent on a development one, so this is
  // asked for rather than assumed. The same test then runs against either.
  const consent = page.locator('#gate-consent');
  if (await consent.count()) await consent.check();

  await page.getByRole('button', { name: 'Sign in' }).click();

  // Keycloak's own form, on its own origin. Reaching it at all is the first
  // thing worth asserting: a client whose redirect URI the realm rejects
  // stops here with "Invalid parameter: redirect_uri" instead.
  await page.waitForURL(/\/realms\/vpm\/protocol\/openid-connect\/auth/);
  await page.locator('#username').fill(username);
  await page.locator('#password').fill(PASSWORD);
  await page.locator('#kc-login').click();

  // Wait for the rail, not for the address.
  //
  // The redirect back lands on `/?code=…` and the token exchange happens
  // after it, so a test that waits on the URL carries on while the
  // application is still unauthenticated — and any navigation it then makes
  // discards the code and puts the gate back. The rail exists only once the
  // exchange has finished.
  await expect(page.locator('nav.rail')).toBeVisible();
}

/**
 * Chosen, not assumed.
 *
 * Which project opens is the service's decision, and a database that has been
 * worked in has more than one. Picking it here is what keeps the counts below
 * meaning something on a developer's machine as well as on a fresh stack, and
 * it exercises the picker on the way past.
 */
async function open(page: Page, project: string): Promise<void> {
  // Clicked rather than navigated to. A goto is a full reload, which throws
  // away everything the application holds in memory and makes every later
  // assertion a test of the reload rather than of the screen.
  await page.getByRole('link', { name: 'Schedule' }).click();

  const picker = page.locator('select.rail__project');
  await expect(picker).toBeVisible();
  await picker.selectOption({ label: project });

  await expect(page.locator('app-task-row').first()).toBeVisible();
}

test.describe('the seeded plan', () => {

  test('reaches the schedule', async ({ page, problems }) => {
    await signIn(page, 'harriet');
    await open(page, PROJECT);

    await expect(page.locator('.toolbar__title')).toHaveText('Schedule');

    // The assertion that matters. Fifteen rows can only be here if the browser
    // asked the API and the API answered: this is the one that fails when the
    // request goes to the wrong address, or goes nowhere at all.
    await expect(page.locator('app-task-row')).toHaveCount(TASKS);

    await expect(page.locator('app-task-row').first()).toContainText('Discovery and analytics review');
    await expect(page.locator('app-task-row').last()).toContainText('Go live');

    // Computed by the backend from the dependency graph, so its presence says
    // the schedule endpoint answered too, not only the task list. Asserted on
    // the band rather than on the readout: there are three of those, and a
    // locator matching three is an error rather than a choice.
    await expect(page.locator('.toolbar')).toContainText('critical path');

    expect(problems, problems.join('\n')).toEqual([]);
  });

  test('draws a bar for every task', async ({ page, problems }) => {
    await signIn(page, 'harriet');
    await open(page, PROJECT);

    await page.getByRole('link', { name: 'Chart' }).click();
    await expect(page.locator('.toolbar__title')).toHaveText('Chart');

    await expect(page.locator('.bar')).toHaveCount(TASKS);

    expect(problems, problems.join('\n')).toEqual([]);
  });

  test('shows a viewer the same plan without the way to change it', async ({ page, problems }) => {
    // Tom is a viewer. The roles are the interesting half of the membership
    // model, and a role that is only enforced on the server is a role nobody
    // sees working.
    await signIn(page, 'tom');
    await open(page, PROJECT);

    await expect(page.locator('app-task-row')).toHaveCount(TASKS);

    await expect(page.getByRole('button', { name: 'New task' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Members' })).toHaveCount(0);

    expect(problems, problems.join('\n')).toEqual([]);
  });
});
