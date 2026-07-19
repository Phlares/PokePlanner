import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('App', () => {
  it('identifies the product and the active FireRed slice', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: 'PokÃ©Planner' })).toBeVisible();
    expect(screen.getByText('FireRed planning data')).toBeVisible();
  });
});
