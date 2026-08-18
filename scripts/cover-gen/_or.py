"""
Shared OpenRouter helpers for the cover-gen toolkit.

- loads OPENROUTER_API_KEY (and model config) from the repo-root .env
- exposes a vision() call (text + one-or-more images) and vision_json()
- encodes local images as data URLs

No third-party deps beyond `openai` (already installed). The .env is parsed by
hand so we don't need python-dotenv.
"""
import os, re, json, base64, mimetypes
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
ENV_PATH = REPO_ROOT / ".env"

# Vision model: env override → configured digest model → hard default.
# Claude Haiku 4.5 is vision-capable; bump via OPENROUTER_VISION_MODEL or --model
# (e.g. anthropic/claude-sonnet-4.5) for richer visual detail.
DEFAULT_MODEL = "anthropic/claude-haiku-4.5"


def load_env() -> None:
    """Populate os.environ from repo-root .env for keys not already set."""
    if not ENV_PATH.exists():
        return
    for raw in ENV_PATH.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        key = key.strip()
        val = val.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = val


def default_model() -> str:
    return (
        os.environ.get("OPENROUTER_VISION_MODEL")
        or os.environ.get("OPENROUTER_DIGEST_MODEL")
        or DEFAULT_MODEL
    )


def client():
    from openai import OpenAI
    import httpx

    load_env()
    key = os.environ.get("OPENROUTER_API_KEY")
    if not key:
        raise SystemExit("OPENROUTER_API_KEY not found (checked env and repo .env)")
    # trust_env=False so a malformed NO_PROXY/HTTP_PROXY in the shell env can't
    # break httpx URL parsing (e.g. a trailing comma → "Invalid port").
    http_client = httpx.Client(trust_env=False, timeout=120.0)
    return OpenAI(
        base_url="https://openrouter.ai/api/v1",
        api_key=key,
        http_client=http_client,
        default_headers={
            "HTTP-Referer": "https://github.com/loydmilligan/music-league-bot",
            "X-Title": "cover-gen",
        },
    )


def encode_image(path) -> str:
    p = Path(path)
    mime = mimetypes.guess_type(p.name)[0] or "image/jpeg"
    b64 = base64.b64encode(p.read_bytes()).decode("ascii")
    return f"data:{mime};base64,{b64}"


def vision(system: str, user_text: str, image_paths=None, model=None, temperature=0.4) -> str:
    cli = client()
    content = [{"type": "text", "text": user_text}]
    for ip in image_paths or []:
        content.append({"type": "image_url", "image_url": {"url": encode_image(ip)}})
    resp = cli.chat.completions.create(
        model=model or default_model(),
        temperature=temperature,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": content},
        ],
    )
    return (resp.choices[0].message.content or "").strip()


def _extract_json(text: str):
    """Best-effort: parse the first balanced {...} or [...] block."""
    text = text.strip()
    # strip ```json fences
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.MULTILINE).strip()
    try:
        return json.loads(text)
    except Exception:
        pass
    for open_ch, close_ch in (("{", "}"), ("[", "]")):
        start = text.find(open_ch)
        if start < 0:
            continue
        depth = 0
        for i in range(start, len(text)):
            if text[i] == open_ch:
                depth += 1
            elif text[i] == close_ch:
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(text[start : i + 1])
                    except Exception:
                        break
    raise ValueError(f"could not parse JSON from model output:\n{text[:500]}")


# Nano Banana. Override via OPENROUTER_IMAGE_MODEL or make --gen-model
# (e.g. google/gemini-3.1-flash-image, google/gemini-3-pro-image, openai/gpt-5-image).
DEFAULT_IMAGE_MODEL = "google/gemini-2.5-flash-image"


def image_model() -> str:
    return os.environ.get("OPENROUTER_IMAGE_MODEL") or DEFAULT_IMAGE_MODEL


def generate_image(prompt: str, image_paths=None, model=None, out_path=None, attempts=4):
    """
    Generate an image via OpenRouter (default: Gemini 2.5 Flash Image / "Nano
    Banana"), passing the prompt plus any reference images. Writes the first
    returned image to out_path and returns its Path.

    Gemini image models intermittently reply with chat TEXT and no image ("Sure,
    here's the cover…"). That's transient, so we retry a few times (a text-only
    reply is nearly free — no image tokens), nudging harder each retry.

    A `content_filter` finish means the cover or a reference photo is
    NSFW/explicit (e.g. a shirtless/nude cover rendered onto a real face). It's
    PROBABILISTIC — a borderline cover sometimes passes — so we still retry, but
    if every attempt is filtered we raise a specific message instead of the
    generic one.
    """
    cli = client()
    imgs = [{"type": "image_url", "image_url": {"url": encode_image(ip)}} for ip in (image_paths or [])]
    nudge = "Generate the album-cover IMAGE directly. Output the image itself — do NOT reply with a text description.\n\n"
    last_text = ""
    filtered = 0
    for attempt in range(1, attempts + 1):
        text = prompt if attempt == 1 else nudge + prompt
        resp = cli.chat.completions.create(
            model=model or image_model(),
            messages=[{"role": "user", "content": [{"type": "text", "text": text}] + imgs}],
            extra_body={"modalities": ["image", "text"]},
        )
        # image outputs live on message.images (OpenRouter image models); read the
        # raw dump so we don't depend on the SDK typing the field.
        choice = (resp.model_dump().get("choices") or [{}])[0]
        msg = choice.get("message") or {}
        images = msg.get("images") or []
        if images:
            url = images[0].get("image_url", {}).get("url", "")
            if url.startswith("data:"):
                raw = base64.b64decode(url.split(",", 1)[1])
                outp = Path(out_path) if out_path else Path("cover.png")
                outp.parent.mkdir(parents=True, exist_ok=True)
                outp.write_bytes(raw)
                return outp
        is_filter = choice.get("finish_reason") == "content_filter"
        filtered += is_filter
        last_text = msg.get("content") or ""
        if attempt < attempts:
            why = "content filter (NSFW cover/ref?)" if is_filter else "transient text reply"
            print(f"  [generate] no image ({why}); retrying {attempt + 1}/{attempts}…")
    if filtered:
        raise RuntimeError(
            f"blocked by the image model's content filter on {filtered}/{attempts} attempts. "
            "The cover or a reference photo is likely NSFW/explicit (e.g. a shirtless/nude "
            "cover onto a real face). Try a different cover or reference."
        )
    raise RuntimeError(f"no image after {attempts} attempts; last model text: {last_text[:200]!r}")


def vision_json(system: str, user_text: str, image_paths=None, model=None, temperature=0.3):
    out = vision(
        system + "\n\nRespond with ONLY valid JSON — no prose, no code fences.",
        user_text,
        image_paths=image_paths,
        model=model,
        temperature=temperature,
    )
    return _extract_json(out)
