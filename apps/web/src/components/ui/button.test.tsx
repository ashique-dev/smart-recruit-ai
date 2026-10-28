import { expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Button } from './button';
test('React test foundation renders the existing disabled button with its accessible text', () => {
  const html = renderToStaticMarkup(<Button disabled>Check now</Button>);
  expect(html).toContain('<button');
  expect(html).toContain('disabled=""');
  expect(html).toContain('Check now</button>');
});
