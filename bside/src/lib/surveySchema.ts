export type FieldType = 'text' | 'longtext' | 'email' | 'singleChoice' | 'ratingGrid' | 'repeatGroup';

export interface Field {
	key: string;
	type: FieldType;
	label: string;
	help?: string;
	placeholder?: string;
	required?: boolean;
	maxLength?: number;
	options?: { value: string; label: string; help?: string }[];
	items?: string[];
	fields?: Field[];
	minItems?: number;
	maxItems?: number;
}

export interface SurveySchema {
	version: 1;
	sections: { heading: string; intro?: string; fields: Field[] }[];
}

function empty(value: unknown): boolean {
	if (value == null) return true;
	if (typeof value === 'string') return value.trim() === '';
	if (Array.isArray(value)) return value.length === 0;
	if (typeof value === 'object') return Object.keys(value as object).length === 0;
	return false;
}

function cleanField(field: Field, raw: unknown): { error?: string; value?: unknown } {
	if (field.type === 'text' || field.type === 'longtext' || field.type === 'email') {
		const value = typeof raw === 'string' ? raw.trim() : '';
		if (field.maxLength && value.length > field.maxLength) return { error: `${field.label} is too long.` };
		if (field.type === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
			return { error: `${field.label} needs an email.` };
		}
		return { value };
	}
	if (field.type === 'singleChoice') {
		const value = typeof raw === 'string' ? raw : '';
		if (value && !field.options?.some((o) => o.value === value)) return { error: `Pick a valid ${field.label}.` };
		return { value };
	}
	if (field.type === 'ratingGrid') {
		const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
		const value: Record<string, number> = {};
		for (const item of field.items ?? []) {
			const n = src[item];
			if (n === '' || n == null) continue;
			if (typeof n !== 'number' || n < 1 || n > 5 || !Number.isInteger(n)) {
				return { error: `${field.label} ratings are 1–5.` };
			}
			value[item] = n;
		}
		return { value };
	}
	if (field.type === 'repeatGroup') {
		const rows = Array.isArray(raw) ? raw : [];
		const value = [];
		for (const row of rows) {
			const obj = row && typeof row === 'object' ? row as Record<string, unknown> : {};
			const next: Record<string, unknown> = {};
			for (const sub of field.fields ?? []) {
				const cleaned = cleanField(sub, obj[sub.key]);
				if (cleaned.error) return cleaned;
				next[sub.key] = cleaned.value;
			}
			value.push(next);
		}
		return { value };
	}
	return { value: raw };
}

export function validateSurvey(schema: SurveySchema, body: unknown): { error?: string; values?: Record<string, unknown> } {
	const input = body && typeof body === 'object' ? body as Record<string, unknown> : {};
	const values: Record<string, unknown> = {};
	for (const field of schema.sections.flatMap((s) => s.fields)) {
		const cleaned = cleanField(field, input[field.key]);
		if (cleaned.error) return cleaned;
		if (field.required && empty(cleaned.value)) return { error: `${field.label} is required.` };
		if (field.type === 'repeatGroup') {
			const list = cleaned.value as unknown[];
			if (field.minItems && list.length < field.minItems) return { error: `Add at least ${field.minItems} to ${field.label}.` };
			if (field.maxItems && list.length > field.maxItems) return { error: `Send up to ${field.maxItems} in ${field.label}.` };
		}
		values[field.key] = cleaned.value;
	}
	return { values };
}
