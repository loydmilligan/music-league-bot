import { describe, it, expect } from 'vitest';
import { avatarFor } from './ballot.js';

// Hip Jammers S4 faces, cropped from the "Bako City" group plate (2026-10-26).
const ROSTER = ['Drew Mariani', 'Gregory Mariani', 'Kristin Visser', 'Lori Mariani', 'Margaret Mariani',
	'Mara Mariani', 'Matt Mariani', 'Ron Mariani', 'Sasha Mariani', 'Michael Mariani'];

describe('hip-jammers faces', () => {
	it('every S4 player resolves to a face', () => {
		for (const name of ROSTER) expect(avatarFor('hip-jammers', name), name).toBe(`av-${name.toLowerCase().replace(' ', '-')}`);
	});
	it('an unknown member gets initials, not a face', () => {
		expect(avatarFor('hip-jammers', 'treehugger')).toBeNull();
	});
});
