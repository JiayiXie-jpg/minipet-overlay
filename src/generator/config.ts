export const VOLC_API_KEY = process.env.VOLC_API_KEY || '4154498e-7d71-451b-b1df-fb8fc922ea22';
export const VOLC_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';

export const SEEDREAM_MODEL = 'doubao-seedream-4-5-251128';
export const SEEDANCE_MODEL = 'doubao-seedance-1-5-pro-251215';
export const VISION_MODEL = 'doubao-1-5-vision-pro-32k-250115';

export type SubjectType = 'pet' | 'child' | 'character';

export const PET_STATES = ['sitting', 'sleeping', 'eating', 'happy', 'talking'] as const;
export type PetState = (typeof PET_STATES)[number];

export function getHeaders() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${VOLC_API_KEY}`,
  };
}
