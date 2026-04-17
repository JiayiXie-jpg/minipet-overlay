import fs from 'fs';
import path from 'path';
import { VOLC_BASE_URL, VISION_MODEL, getHeaders, SubjectType } from './config';

export interface SubjectInfo {
  description: string;
  subjectType: SubjectType;
}

export async function describeSubject(photoPath: string): Promise<SubjectInfo> {
  const ext = path.extname(photoPath).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
  const b64 = fs.readFileSync(photoPath).toString('base64');
  const dataUri = `data:${mime};base64,${b64}`;

  const payload = {
    model: VISION_MODEL,
    messages: [
      {
        role: 'system',
        content:
          'You are a subject identification assistant. Look at the photo and determine:\n' +
          '1. Is the main subject a pet/animal, a human child/baby/toddler, or an anime/cartoon/fictional character?\n' +
          '2. Describe the subject in one short English sentence.\n\n' +
          'Reply in EXACTLY this format (two lines):\n' +
          'TYPE: pet\n' +
          'DESCRIPTION: a gray-white tabby cat with big round eyes\n\n' +
          'Or:\n' +
          'TYPE: child\n' +
          'DESCRIPTION: a toddler boy with short brown hair wearing a blue shirt\n\n' +
          'Or:\n' +
          'TYPE: character\n' +
          'DESCRIPTION: a muscular anime male character with brown hair wearing a blue outfit\n\n' +
          'For TYPE, use "pet" for any real animal, "child" for any real human child/baby/toddler, ' +
          '"character" for any anime, cartoon, manga, comic, game, or fictional character (2D or 3D stylized).\n' +
          'For DESCRIPTION, keep it under 20 words. Include distinctive features.',
      },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: dataUri } },
          { type: 'text', text: 'Identify and describe this subject.' },
        ],
      },
    ],
    max_tokens: 150,
  };

  console.log('  [Vision] Identifying subject from photo...');

  const res = await fetch(`${VOLC_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    console.warn(`  [Vision] API error: ${res.status} - ${text.slice(0, 200)}`);
    return { description: 'a cute pet', subjectType: 'pet' };
  }

  const data = await res.json();
  const raw = data?.choices?.[0]?.message?.content?.trim() || '';

  let subjectType: SubjectType = 'pet';
  let description = 'a cute pet';

  const typeMatch = raw.match(/TYPE:\s*(pet|child|character)/i);
  if (typeMatch) {
    subjectType = typeMatch[1].toLowerCase() as SubjectType;
  }

  const descMatch = raw.match(/DESCRIPTION:\s*(.+)/i);
  if (descMatch) {
    description = descMatch[1].trim();
  } else if (!typeMatch) {
    description = raw.split('\n')[0].trim() || 'a cute pet';
  }

  if (description === 'a cute pet' && subjectType === 'child') {
    description = 'a cute toddler';
  }

  console.log(`  [Vision] Type: ${subjectType}, Description: ${description}`);
  return { description, subjectType };
}
