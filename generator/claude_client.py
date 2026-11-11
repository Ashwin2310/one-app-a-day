"""Thin wrapper around the Anthropic Messages API with clear error messages."""
from __future__ import annotations

import logging

import anthropic

from .config import API_MAX_RETRIES, API_TIMEOUT_SECONDS, MODEL, PipelineError, env

log = logging.getLogger("daily-app")


def make_client() -> anthropic.Anthropic:
    api_key = env("ANTHROPIC_API_KEY")
    if not api_key:
        raise PipelineError("ANTHROPIC_API_KEY is not set.")
    return anthropic.Anthropic(api_key=api_key, max_retries=API_MAX_RETRIES, timeout=API_TIMEOUT_SECONDS)


def ask(client: anthropic.Anthropic, system: str, user: str, max_tokens: int) -> str:
    """Stream one request (avoids HTTP timeouts on long replies) and return the text."""
    try:
        with client.messages.stream(
            model=MODEL,
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": user}],
        ) as stream:
            message = stream.get_final_message()
    except anthropic.AuthenticationError as exc:
        raise PipelineError("Anthropic rejected ANTHROPIC_API_KEY (401). Check the secret.") from exc
    except anthropic.PermissionDeniedError as exc:
        raise PipelineError("Anthropic denied access (403). Check billing/credits.") from exc
    except anthropic.NotFoundError as exc:
        raise PipelineError(f"Model '{MODEL}' not found. Set the ANTHROPIC_MODEL variable.") from exc
    except anthropic.RateLimitError as exc:
        raise PipelineError("Anthropic rate limit hit even after retries.") from exc
    except anthropic.APIStatusError as exc:
        raise PipelineError(f"Anthropic API error {exc.status_code}: {exc.message}") from exc
    except anthropic.APIConnectionError as exc:
        raise PipelineError(f"Could not reach the Anthropic API: {exc}") from exc

    if message.stop_reason == "max_tokens":
        raise PipelineError(f"Claude's reply was cut off at max_tokens={max_tokens}.")
    text = "".join(b.text for b in message.content if b.type == "text").strip()
    if not text:
        raise PipelineError(f"Empty reply from Claude (stop_reason={message.stop_reason}).")
    log.info("Claude replied: %d chars, %d output tokens.", len(text), message.usage.output_tokens)
    return text
