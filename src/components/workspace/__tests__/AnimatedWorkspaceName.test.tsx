import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnimatedWorkspaceName } from '../AnimatedWorkspaceName';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('AnimatedWorkspaceName', () => {
  it('renders the initial name immediately', () => {
    const view = render(<AnimatedWorkspaceName name="Planning Pass" />);
    expect(view.container.textContent).toBe('Planning Pass');
  });

  it('animates renamed workspace text with a temporary jumble', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const view = render(<AnimatedWorkspaceName name="Old Name" />);
    view.rerender(<AnimatedWorkspaceName name="New Name" />);

    expect(view.container.textContent).toBe('Old Name');

    act(() => {
      vi.advanceTimersByTime(90);
    });
    expect(view.container.textContent).not.toBe('Old Name');
    expect(view.container.textContent).not.toBe('New Name');

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(view.container.textContent).toBe('New Name');
  });
});
