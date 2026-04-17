import fs from 'fs';
import path from 'path';
import { describeSubject } from './describe';
import { generateBaseImage } from './seedream';
import { generateAllVideos } from './seedance';

type ProgressCallback = (stage: string, progress: number, message: string) => void;

const MATTING_API = process.env.MATTING_API || 'http://118.196.36.27:8765/api/matting';

async function matteVideo(inputMp4: string, outputWebm: string, description: string, state: string): Promise<void> {
  console.log(`  [Matte] Uploading: ${path.basename(inputMp4)} (${state})`);

  const fileBuffer = fs.readFileSync(inputMp4);
  const blob = new Blob([fileBuffer], { type: 'video/mp4' });

  const form = new FormData();
  form.append('video', blob, path.basename(inputMp4));
  form.append('description', description);
  form.append('state', state);

  const res = await fetch(MATTING_API, {
    method: 'POST',
    body: form,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Matting API error: ${res.status} - ${text.slice(0, 200)}`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(outputWebm, buf);
  const sizeKb = Math.round(buf.length / 1024);
  console.log(`  [Matte] Done: ${path.basename(outputWebm)} (${sizeKb} KB)`);
}

export async function generatePetAssets(
  photoPath: string,
  outputDir: string,
  progressCallback?: ProgressCallback,
): Promise<Record<string, any>> {
  fs.mkdirSync(outputDir, { recursive: true });
  const imagesDir = path.join(outputDir, 'images');
  const videosDir = path.join(outputDir, 'videos');
  const mattedDir = path.join(outputDir, 'matted');
  const manifestPath = path.join(outputDir, 'manifest.json');

  // Clean old assets
  console.log('Cleaning old assets...');
  fs.rmSync(imagesDir, { recursive: true, force: true });
  fs.rmSync(videosDir, { recursive: true, force: true });
  fs.rmSync(mattedDir, { recursive: true, force: true });
  if (fs.existsSync(manifestPath)) fs.unlinkSync(manifestPath);

  // Stage 0: Vision LLM identifies subject
  console.log('\n=== Stage 0: Identifying subject (Vision LLM) ===');
  progressCallback?.('vision', 0, 'Identifying subject...');
  const { description, subjectType } = await describeSubject(photoPath);
  progressCallback?.('vision', 1.0, `Identified: ${subjectType} - ${description}`);

  // Stage 1: Generate base image
  console.log('\n=== Stage 1: Generating base image (Seedream) ===');
  progressCallback?.('seedream', 0, 'Generating base image...');
  const baseImage = await generateBaseImage(photoPath, imagesDir, description, subjectType);
  progressCallback?.('seedream', 1.0, 'Base image complete');

  // Stage 2: Generate 8 state videos
  console.log('\n=== Stage 2: Generating animations (Seedance) ===');
  progressCallback?.('seedance', 0, 'Generating animations...');
  const videos = await generateAllVideos(baseImage, videosDir, (current, total, message) => {
    progressCallback?.('seedance', current / total, message);
  }, subjectType);
  progressCallback?.('seedance', 1.0, 'Animations complete');

  // Stage 3: Matte all videos (SAM3 -> WebM alpha)
  console.log('\n=== Stage 3: Video matting (SAM3) ===');
  fs.mkdirSync(mattedDir, { recursive: true });
  const mattedVideos: Record<string, string> = {};
  const states = Object.keys(videos.idle);
  let mattedCount = 0;

  for (const state of states) {
    const mp4Path = videos.idle[state];
    const webmPath = path.join(mattedDir, `${state}.webm`);

    if (fs.existsSync(webmPath)) {
      console.log(`  [Matte] ${state}.webm already exists, skipping`);
      mattedVideos[state] = webmPath;
      mattedCount++;
      continue;
    }

    progressCallback?.('matting', mattedCount / states.length, `Matting ${state}...`);

    try {
      await matteVideo(mp4Path, webmPath, description, state);
      mattedVideos[state] = webmPath;
    } catch (e: any) {
      console.error(`  [Matte] Failed for ${state}: ${e.message}`);
      mattedVideos[state] = mp4Path;
    }
    mattedCount++;
  }
  progressCallback?.('matting', 1.0, 'Matting complete');

  // Save manifest
  const manifest = {
    subject_type: subjectType,
    subject_description: description,
    photo: photoPath,
    base_image: baseImage,
    videos: {
      idle: videos.idle,
      matted: mattedVideos,
    },
  };

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  console.log('\n=== Asset generation complete ===');
  console.log(`Subject: ${subjectType} - ${description}`);
  console.log(`Output: ${outputDir}`);

  return manifest;
}
