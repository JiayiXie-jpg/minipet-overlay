"""Video matting using SAM3 segmentation API — get mask, then ffmpeg composite to WebM with alpha."""
import sys
import os
import subprocess
import time
import json
import shutil
import tempfile
import re
import urllib.request
import requests

BASE_URL = "https://mipixgen-pre.ai.mioffice.cn"
HEADERS = {"Authorization": f"Bearer {os.environ.get('MIPIXGEN_API_KEY', 'sk-mipixgen-test')}"}
SEG_ENDPOINT = "/customize/xiaomi-ev/video_obj_removal/customize/v1/videos/sam3_prompt_seg"

# LLM config for keyword extraction
VOLC_API_KEY = os.environ.get('VOLC_API_KEY', '4154498e-7d71-451b-b1df-fb8fc922ea22')
VOLC_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3'
VISION_MODEL = 'doubao-1-5-vision-pro-32k-250115'

LLM_KEYWORD_PROMPT = (
    'You are a keyword extraction assistant for SAM3 video segmentation.\n'
    'Given a subject description and a video state, output a JSON array of English keywords '
    'that SAM3 should use to segment ALL foreground objects from the background.\n\n'
    'Rules:\n'
    '- The FIRST keyword must be the main subject. Use the specific breed/species for real animals (e.g. "corgi", "pug", "tabby cat").\n'
    '- For cartoon/anime/fictional/robotic characters (e.g. Doraemon, Hello Kitty, Pikachu, anime characters), '
    'the first keyword MUST be "character". Do NOT use "cat", "robot", "toy" etc. for fictional characters — SAM3 cannot recognize them that way.\n'
    '- For real toys/figures/plush: use "toy" as first keyword.\n'
    '- For children: use "child" as first keyword.\n'
    '- For "eating" state: also include "bowl", "food", "plate" as applicable.\n'
    '- If description mentions accessories (hat, scarf, bow, glasses, costume, star), include them.\n'
    '- Each keyword: 1-2 words, concrete nouns SAM3 can recognize.\n'
    '- Output ONLY a JSON array, nothing else.\n\n'
    'Examples:\n'
    'Input: Subject: "a corgi with a red scarf", State: "eating"\n'
    'Output: ["corgi", "scarf", "bowl", "food"]\n\n'
    'Input: Subject: "a blue robotic cat holding a yellow star", State: "sitting"\n'
    'Output: ["character", "star"]\n\n'
    'Input: Subject: "a Hello-Kitty figure with a pink bow", State: "sleeping"\n'
    'Output: ["character", "bow"]'
)


def llm_extract_keywords(description, state):
    """Use Vision LLM to extract SAM3-compatible keywords from description + state."""
    headers = {
        'Content-Type': 'application/json',
        'Authorization': f'Bearer {VOLC_API_KEY}',
    }
    payload = {
        'model': VISION_MODEL,
        'messages': [
            {'role': 'system', 'content': LLM_KEYWORD_PROMPT},
            {'role': 'user', 'content': f'Subject: "{description}", State: "{state}"'},
        ],
        'max_tokens': 100,
    }
    try:
        req = urllib.request.Request(
            f'{VOLC_BASE_URL}/chat/completions',
            data=json.dumps(payload).encode(),
            headers=headers,
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read())
        raw = result['choices'][0]['message']['content'].strip()
        keywords = json.loads(raw)
        if isinstance(keywords, list) and len(keywords) > 0:
            print(f"  [Matte] LLM keywords: {keywords}")
            return keywords
    except Exception as e:
        print(f"  [Matte] LLM keyword extraction failed: {e}")

    # Fallback: extract from description using simple heuristics
    print(f"  [Matte] Falling back to heuristic keyword extraction")
    return _fallback_extract_keywords(description, state)


def _fallback_extract_keywords(description, state):
    """Fallback keyword extraction when LLM is unavailable."""
    text_lower = description.lower()
    keywords = []

    # Try to find subject keyword
    subject_list = [
        "cat", "kitten", "tabby", "dog", "puppy", "pomeranian", "bichon",
        "retriever", "sheepadoodle", "schnauzer", "poodle", "corgi", "husky",
        "labrador", "bulldog", "terrier", "shepherd", "beagle", "dachshund",
        "chihuahua", "pug", "samoyed", "maltese", "shiba", "akita", "collie",
        "spaniel", "rottweiler", "doberman", "boxer", "dalmatian", "malamute",
        "greyhound", "whippet", "mastiff", "newfoundland", "bird", "parrot",
        "rabbit", "hamster", "fish", "turtle", "tortoise", "gecko", "lizard",
        "elephant", "panda", "bear", "fox", "deer", "monkey", "pig",
        "child", "toddler", "baby", "boy", "girl", "toy", "character",
    ]
    overrides = {"hello": "toy", "kitty": "toy", "anime": "character",
                 "cartoon": "character", "manga": "character"}
    for trigger, replacement in overrides.items():
        if trigger in text_lower:
            keywords.append(replacement)
            break
    if not keywords:
        for kw in subject_list:
            if kw in text_lower:
                keywords.append(kw)
                break
    if not keywords:
        keywords.append("dog")

    # Add state-specific props
    if state == "eating":
        keywords.extend(["bowl", "food"])

    return keywords


def compress_video(input_path, output_path, scale=512):
    cmd = ["ffmpeg", "-i", input_path, "-vf", f"scale={scale}:-2", "-crf", "28", "-y", output_path]
    subprocess.run(cmd, check=True, capture_output=True)


def get_video_frame_count(video_path):
    """Get total frame count of a video."""
    probe = subprocess.run(
        ["ffprobe", "-v", "quiet", "-count_frames", "-select_streams", "v:0",
         "-show_entries", "stream=nb_read_frames", "-print_format", "json", video_path],
        capture_output=True, text=True
    )
    try:
        data = json.loads(probe.stdout)
        return int(data["streams"][0]["nb_read_frames"])
    except Exception:
        return 0


def submit_segmentation(video_path, text="cat", frame_index=0):
    with open(video_path, "rb") as f:
        resp = requests.post(
            f"{BASE_URL}{SEG_ENDPOINT}",
            headers=HEADERS,
            files={"input_video": f},
            data={"text": text, "frame_index": frame_index},
        )
    print(f"  [Matte] SAM3 response status: {resp.status_code}")
    if resp.status_code != 200:
        print(f"  [Matte] SAM3 response body: {resp.text[:500]}")
        raise Exception(f"SAM3 HTTP error: {resp.status_code}")
    return resp.json()


def poll_task(task_id, max_wait=300):
    for i in range(max_wait // 3):
        time.sleep(3)
        resp = requests.get(f"{BASE_URL}{SEG_ENDPOINT}/status/{task_id}", headers=HEADERS)
        data = resp.json()
        status = data.get("status")
        print(f"  [{i*3}s] Status: {status}")
        if status == "completed":
            return data
        elif status == "failed":
            raise Exception(f"Task failed: {data.get('error_message')}")
    raise Exception("Task timeout")


def download_file(url, output_path):
    resp = requests.get(url)
    with open(output_path, "wb") as f:
        f.write(resp.content)


def convert_mask_to_white(input_mask, output_mask, target_ids):
    if not target_ids:
        cmd = ["ffmpeg", "-i", input_mask, "-vf", "geq=lum='if(gt(lum(X,Y),0),255,0)'",
               "-pix_fmt", "gray", "-y", output_mask]
    else:
        conditions = "+".join([f"eq(lum(X,Y),{tid})" for tid in target_ids])
        cmd = ["ffmpeg", "-i", input_mask, "-vf", f"geq=lum='if({conditions},255,0)'",
               "-pix_fmt", "gray", "-y", output_mask]
    subprocess.run(cmd, check=True, capture_output=True)


def merge_masks(mask_a, mask_b, output_mask):
    """Merge two binary masks: white where either is white."""
    cmd = [
        "ffmpeg", "-y",
        "-i", mask_a,
        "-i", mask_b,
        "-filter_complex",
        "[0:v][1:v]blend=all_mode=lighten[out]",
        "-map", "[out]",
        "-pix_fmt", "gray",
        output_mask,
    ]
    subprocess.run(cmd, check=True, capture_output=True)


def apply_mask_to_video(input_video, mask_video, output_webm):
    # Get original video dimensions and fps
    probe = subprocess.run(
        ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_streams", input_video],
        capture_output=True, text=True
    )
    streams = json.loads(probe.stdout)["streams"]
    width, height, fps = 960, 960, "24"
    for s in streams:
        if s["codec_type"] == "video":
            width = int(s["width"])
            height = int(s["height"])
            fps = s.get("r_frame_rate", "24")
            break

    # Scale mask to match original video size and fps, then alphamerge
    cmd = [
        "ffmpeg", "-y",
        "-i", input_video,
        "-i", mask_video,
        "-filter_complex",
        f"[1:v]format=gray,scale={width}:{height},fps={fps},setpts=PTS-STARTPTS[mask];"
        f"[0:v]format=rgba,setpts=PTS-STARTPTS[rgb];"
        f"[rgb][mask]alphamerge[out]",
        "-map", "[out]",
        "-c:v", "libvpx-vp9",
        "-pix_fmt", "yuva420p",
        "-b:v", "2M",
        "-auto-alt-ref", "0",
        "-shortest",
        "-an",
        output_webm,
    ]
    print(f"  [Matte] Encoding WebM with alpha ({width}x{height} @ {fps})...")
    subprocess.run(cmd, check=True, capture_output=True)




def segment_one(upload_video, text, tmp_dir, label, frame_index=0):
    """Run one SAM3 segmentation, return (binary_mask_path, has_objects)."""
    print(f"  [Matte] Segmenting '{text}' ({label}, frame={frame_index})...")
    seg_result = submit_segmentation(upload_video, text=text, frame_index=frame_index)
    if seg_result.get("code") != 0:
        raise Exception(f"SAM3 error: {seg_result}")

    task_id = seg_result["task_id"]
    print(f"  [Matte] Task ID ({label}): {task_id}")
    seg_data = poll_task(task_id)

    suggest = seg_data.get("extra_info", {}).get("suggest_obj", "")
    obj_boxes = seg_data.get("extra_info", {}).get("object_boxes", {})
    print(f"  [Matte] Objects ({label}): {obj_boxes}")

    mask_raw = os.path.join(tmp_dir, f"mask_raw_{label}.mkv")
    download_file(seg_data["video_path"], mask_raw)

    target_ids = []
    if suggest:
        ids = re.findall(r'\b(\d+)\b', suggest)
        if ids:
            target_ids = [int(x) for x in ids]

    mask_bw = os.path.join(tmp_dir, f"mask_bw_{label}.mp4")
    convert_mask_to_white(mask_raw, mask_bw, target_ids)
    return mask_bw, bool(obj_boxes)


def segment_with_probe(upload_video, text, tmp_dir, label, total_frames):
    """Try a few frames to find one where the object is detected, then segment.

    Probes frames at 1/3, 2/3 of total frames (just 2 attempts).
    Returns mask path or None if object not found.
    """
    if total_frames <= 0:
        total_frames = 120  # fallback ~5s at 24fps

    # Only probe 2 frames — fast fail if object doesn't exist
    candidates = sorted(set([
        total_frames // 3,
        total_frames * 2 // 3,
    ]))

    for attempt, frame_idx in enumerate(candidates):
        frame_idx = max(1, min(frame_idx, total_frames - 1))
        try:
            mask_bw, has_objects = segment_one(
                upload_video, text, tmp_dir, f"{label}_try{attempt}", frame_index=frame_idx
            )
            if has_objects:
                print(f"  [Matte] Found '{text}' at frame {frame_idx}")
                return mask_bw
            else:
                print(f"  [Matte] '{text}' not found at frame {frame_idx}, trying next...")
        except Exception as e:
            print(f"  [Matte] Error probing frame {frame_idx}: {e}")

    # Object not found — skip it entirely (don't waste time on fallback)
    print(f"  [Matte] '{text}' not detected, skipping")
    return None


def matte_video(input_mp4, output_webm, description="cat", state="sitting"):
    """Full pipeline: LLM keyword extraction → SAM3 segment → mask → WebM with alpha.

    Args:
        description: subject description (e.g. "a light-brown pug with a curled tail")
        state: video state name (e.g. "eating", "sitting", "sleeping", "moving")
    """
    print(f"  [Matte] Input: {input_mp4}")
    print(f"  [Matte] Description: {description}, State: {state}")

    # Step 1: LLM extracts all keywords (subject + accessories + state props)
    keywords = llm_extract_keywords(description, state)
    if not keywords:
        print("  [Matte] No keywords extracted, aborting")
        raise Exception("No keywords extracted")

    tmp_dir = tempfile.mkdtemp(prefix="matte_sam3_")

    # Compress
    file_size = os.path.getsize(input_mp4)
    if file_size > 200 * 1024:
        compressed = os.path.join(tmp_dir, "compressed.mp4")
        print(f"  [Matte] Compressing ({file_size // 1024} KB)...")
        compress_video(input_mp4, compressed)
        upload_video = compressed
    else:
        upload_video = input_mp4

    # Step 2: Segment first keyword (main subject) at frame 0
    main_keyword = keywords[0]
    print(f"  [Matte] Segmenting main subject: '{main_keyword}'")
    final_mask, has_obj = segment_one(upload_video, main_keyword, tmp_dir, "main", frame_index=0)

    if not has_obj:
        print(f"  [Matte] WARNING: main subject '{main_keyword}' not detected!")

    # Step 3: Segment additional keywords by probing multiple frames
    if len(keywords) > 1:
        total_frames = get_video_frame_count(upload_video)
        print(f"  [Matte] Total frames: {total_frames}")
        for i, kw in enumerate(keywords[1:]):
            print(f"  [Matte] Segmenting extra: '{kw}'")
            try:
                obj_mask = segment_with_probe(upload_video, kw, tmp_dir, f"extra_{i}", total_frames)
                if obj_mask:
                    merged = os.path.join(tmp_dir, f"merged_{i}.mp4")
                    merge_masks(final_mask, obj_mask, merged)
                    final_mask = merged
                    print(f"  [Matte] Merged '{kw}' into mask")
            except Exception as e:
                print(f"  [Matte] Failed to segment '{kw}': {e}, skipping")

    # Step 4: Apply mask → WebM
    os.makedirs(os.path.dirname(output_webm) or ".", exist_ok=True)
    apply_mask_to_video(input_mp4, final_mask, output_webm)

    size_kb = os.path.getsize(output_webm) // 1024
    print(f"  [Matte] Output: {output_webm} ({size_kb} KB)")
    shutil.rmtree(tmp_dir, ignore_errors=True)


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(f"Usage: python {sys.argv[0]} input.mp4 output.webm [description] [state]")
        sys.exit(1)
    description = sys.argv[3] if len(sys.argv) > 3 else "cat"
    state = sys.argv[4] if len(sys.argv) > 4 else "sitting"
    matte_video(sys.argv[1], sys.argv[2], description, state)
