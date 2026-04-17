import fs from 'fs';
import path from 'path';
import { VOLC_BASE_URL, SEEDREAM_MODEL, getHeaders, SubjectType } from './config';

function loadImageAsDataUri(imagePath: string): string {
  const ext = path.extname(imagePath).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
  const b64 = fs.readFileSync(imagePath).toString('base64');
  return `data:${mime};base64,${b64}`;
}

export async function generateBaseImage(
  photoPath: string,
  outputDir: string,
  description: string,
  subjectType: SubjectType = 'pet',
): Promise<string> {
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, 'base.png');

  if (fs.existsSync(outputPath)) {
    console.log('  [Seedream] base.png already exists, skipping');
    return outputPath;
  }

  const refUri = loadImageAsDataUri(photoPath);
  const text = description.toLowerCase();
  let prompt: string;

  if (subjectType === 'child') {
    prompt = 'Same child as reference image, sitting on the floor, looking at camera, happy expression, solid light background, full body, centered';
  } else if (subjectType === 'character') {
    prompt = 'Same character as reference image, standing perfectly still, looking at camera, solid plain background, full body, centered, anime style';
  } else if (/fish|fins|piranha|whale/.test(text)) {
    prompt = 'Same animal as reference image, swimming perfectly still, solid white background, full body, centered';
  } else if (/dog|puppy|pomeranian|retriever|bulldog|terrier|poodle|corgi|husky|labrador|schnauzer|beagle|dachshund|chihuahua|bichon|sheepadoodle|shepherd/.test(text)) {
    prompt = 'Same animal as reference image, sitting perfectly still, happy expression, solid gray background, full body, centered';
  } else if (/cat|kitten|tabby/.test(text)) {
    prompt = 'Same animal as reference image, sitting perfectly still, looking at camera, solid yellow background, full body, centered';
  } else if (/bird|parrot|parakeet|canary|finch|cockatiel/.test(text)) {
    prompt = 'Same animal as reference image, standing on a perch, looking at camera, solid light background, full body, centered';
  } else {
    prompt = 'Same animal as reference image, standing perfectly still, looking at camera, solid plain background, full body, centered';
  }

  const payload: Record<string, any> = {
    model: SEEDREAM_MODEL,
    prompt,
    image: [refUri],
    reference_strength: 0.9,
    size: '2K',
    n: 1,
    response_format: 'url',
  };

  console.log('  [Seedream] Generating base.png ...');

  const res = await fetch(`${VOLC_BASE_URL}/images/generations`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Seedream API error: ${res.status} - ${errText.slice(0, 300)}`);
  }

  const result = await res.json();
  const imgUrl = result?.data?.[0]?.url;
  if (!imgUrl) {
    throw new Error(`Seedream returned no image URL: ${JSON.stringify(result)}`);
  }

  const imgRes = await fetch(imgUrl);
  const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
  fs.writeFileSync(outputPath, imgBuffer);

  console.log(`  [Seedream] Saved: ${outputPath} (${Math.round(imgBuffer.length / 1024)} KB)`);
  return outputPath;
}
