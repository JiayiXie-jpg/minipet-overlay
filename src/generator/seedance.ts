import fs from 'fs';
import path from 'path';
import { VOLC_BASE_URL, VOLC_API_KEY, SEEDANCE_MODEL, getHeaders, SubjectType } from './config';

// 5 states with motion prompts for each subject type
const PET_STATE_PROMPTS: Record<string, string> = {
  sitting: 'occasional slow blink, very subtle ear twitch, body stays completely still',
  sleeping: 'slowly closes eyes, head gently droops down, dozing off peacefully, then opens eyes again',
  eating: 'a food bowl appears on the ground, the animal lowers head down to the bowl and eats from it, chewing gently, then raises head back to original position',
  happy: 'bounces lightly in place with joy, tail wagging excitedly, bright happy expression',
  talking: 'mouth opens and closes as if speaking, gentle head nods, animated lively expression',
};

const CHILD_STATE_PROMPTS: Record<string, string> = {
  sitting: 'occasional slow blink, subtle head tilt, body stays still, looking around curiously',
  sleeping: 'slowly closes eyes, head gently nods down, dozing off peacefully, gentle breathing, then opens eyes again',
  eating: 'a small plate of snacks appears, the child picks up food and eats it, chewing happily, then puts hands down',
  happy: 'claps hands together excitedly, bounces with joy, bright happy smile',
  talking: 'mouth moves as if babbling words, animated hand gestures, expressive face',
};

const CHARACTER_STATE_PROMPTS: Record<string, string> = {
  sitting: 'occasional slow blink, subtle body sway, stays mostly still, looking forward',
  sleeping: 'slowly closes eyes, head gently droops down, dozing off peacefully, then opens eyes again',
  eating: 'a plate of food appears on the ground, the character bends down to eat from it, then stands back up',
  happy: 'pumps fist in celebration, bright joyful expression, slight jump, then returns to pose',
  talking: 'mouth moves animatedly as if speaking, gestures with one hand, expressive face',
};

function getStatePrompts(subjectType: SubjectType): Record<string, string> {
  if (subjectType === 'child') return CHILD_STATE_PROMPTS;
  if (subjectType === 'character') return CHARACTER_STATE_PROMPTS;
  return PET_STATE_PROMPTS;
}

function loadImageAsDataUri(imagePath: string): string {
  const ext = path.extname(imagePath).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
  const b64 = fs.readFileSync(imagePath).toString('base64');
  return `data:${mime};base64,${b64}`;
}

async function submitVideoTask(
  firstImagePath: string,
  lastImagePath: string,
  motionPrompt: string,
  duration: number = 5,
): Promise<string> {
  const firstUri = loadImageAsDataUri(firstImagePath);
  const lastUri = loadImageAsDataUri(lastImagePath);
  const promptText = `${motionPrompt}, fixed camera, static shot, no camera movement --duration ${duration} --watermark false`;

  const content: any[] = [
    { type: 'text', text: promptText },
    { type: 'image_url', image_url: { url: firstUri }, role: 'first_frame' },
    { type: 'image_url', image_url: { url: lastUri }, role: 'last_frame' },
  ];

  const res = await fetch(`${VOLC_BASE_URL}/contents/generations/tasks`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ model: SEEDANCE_MODEL, content }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Seedance submit error: ${res.status} - ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  const taskId = data?.id;
  if (!taskId) throw new Error(`Seedance returned no task ID: ${JSON.stringify(data)}`);
  return taskId;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function downloadVideo(videoUrl: string, outputPath: string): Promise<void> {
  const res = await fetch(videoUrl);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(outputPath, buf);
}

type ProgressCallback = (current: number, total: number, message: string) => void;

interface TaskEntry {
  taskId: string | null;
  outputPath: string;
  label: string;
}

export async function generateAllVideos(
  baseImagePath: string,
  outputDir: string,
  progressCallback?: ProgressCallback,
  subjectType: SubjectType = 'pet',
): Promise<{ idle: Record<string, string> }> {
  fs.mkdirSync(outputDir, { recursive: true });

  const tasks: TaskEntry[] = [];
  const statePrompts = getStatePrompts(subjectType);

  for (const [state, prompt] of Object.entries(statePrompts)) {
    const outPath = path.join(outputDir, `${state}.mp4`);
    if (fs.existsSync(outPath)) {
      console.log(`  [Seedance] ${state}.mp4 already exists, skipping`);
      tasks.push({ taskId: null, outputPath: outPath, label: state });
      continue;
    }
    const taskId = await submitVideoTask(baseImagePath, baseImagePath, prompt, 5);
    tasks.push({ taskId, outputPath: outPath, label: state });
    console.log(`  [Seedance] ${state}: task ${taskId}`);
  }

  // Poll all tasks
  let pending = tasks.filter((t) => t.taskId !== null);
  const total = tasks.length;
  let completed = total - pending.length;

  console.log(`\n  [Seedance] ${pending.length} tasks submitted, polling...`);

  const pollHeaders = { Authorization: `Bearer ${VOLC_API_KEY}` };

  while (pending.length > 0) {
    await sleep(5000);
    const stillPending: TaskEntry[] = [];

    for (const task of pending) {
      try {
        const res = await fetch(
          `${VOLC_BASE_URL}/contents/generations/tasks/${task.taskId}`,
          { headers: pollHeaders },
        );
        const data = await res.json();
        const status = data?.status;

        if (status === 'succeeded') {
          const videoUrl = data?.content?.video_url;
          if (videoUrl) {
            await downloadVideo(videoUrl, task.outputPath);
            completed++;
            const sizeKb = Math.round(fs.statSync(task.outputPath).size / 1024);
            console.log(`  [Seedance] ${task.label} downloaded (${sizeKb} KB)`);
            progressCallback?.(completed, total, `${task.label} done`);
          }
          continue;
        }
        if (status === 'failed') {
          const errMsg = data?.error?.message || 'unknown';
          console.log(`  [Seedance] ${task.label} FAILED: ${errMsg}`);
          completed++;
          continue;
        }
      } catch {
        // will retry
      }
      stillPending.push(task);
    }

    pending = stillPending;
    if (pending.length > 0) {
      console.log(`  [Seedance] ${completed}/${total} done, ${pending.length} pending...`);
    }
  }

  const idle: Record<string, string> = {};
  for (const task of tasks) {
    if (fs.existsSync(task.outputPath)) {
      idle[task.label] = task.outputPath;
    }
  }

  return { idle };
}
