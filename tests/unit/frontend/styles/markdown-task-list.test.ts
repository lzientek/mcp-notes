import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Guards a layout regression that is invisible to every other test: rendered
 * markdown is injected as raw HTML, so nothing type-checks or renders it, and
 * the damage only showed up by eye on a note with inline code in a task list.
 *
 * A `display: flex` on the list item makes each inline node its own flex item,
 * so a sentence with three <code> spans is laid out as four narrow columns.
 */
const css = readFileSync(
  fileURLToPath(new URL('../../../../src/frontend/dashboard.css', import.meta.url)),
  'utf8',
);

/** Rough rule splitter — enough for a flat stylesheet with no nesting. */
function rules(): { selector: string; body: string }[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selector: m[1].replace(/\/\*[\s\S]*?\*\//g, '').trim().replace(/\s+/g, ' '),
    body: m[2],
  }));
}

function targetsTaskListItem(selector: string): boolean {
  return (
    selector.includes('li:has(> input[type="checkbox"])') ||
    selector.includes('li.task-list-item')
  );
}

describe('markdown task list layout', () => {
  it('never makes a task list item a flex container', () => {
    const offenders = rules()
      .filter((r) => targetsTaskListItem(r.selector))
      .filter((r) => /display:\s*(inline-)?flex/.test(r.body))
      .map((r) => r.selector);

    expect(offenders).toEqual([]);
  });

  it('lays the item out as a block with room for the checkbox', () => {
    const rule = rules().find((r) => targetsTaskListItem(r.selector) && r.body.includes('display'));
    expect(rule).toBeDefined();
    expect(rule?.body).toMatch(/display:\s*block/);
    expect(rule?.body).toMatch(/position:\s*relative/);
    expect(rule?.body).toMatch(/padding-left:/);
  });

  it('takes the checkbox out of the flow so the text stays one inline run', () => {
    const rule = rules().find((r) => r.selector === '.markdown-body li > input[type="checkbox"]');
    expect(rule).toBeDefined();
    expect(rule?.body).toMatch(/position:\s*absolute/);
  });

  it('lets a long identifier in inline code wrap instead of overflowing', () => {
    const rule = rules().find((r) => r.selector === '.markdown-body code');
    expect(rule?.body).toMatch(/overflow-wrap:\s*anywhere/);
  });
});
