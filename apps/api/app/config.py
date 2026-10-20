from functools import lru_cache
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = (
        "postgresql+psycopg://lectureloop:local-development-change-before-deploy@localhost:5432/lectureloop"
    )
    app_origin: str = "http://localhost:8080"
    cookie_secure: bool = False
    media_root: str = "/media"
    max_upload_mb: int = 100
    openai_api_key: str = ""
    openai_base_url: str = "https://api.openai.com/v1"
    openai_text_model: str = "gpt-4.1-mini"
    openai_embed_model: str = "text-embedding-3-small"
    openai_embed_dimensions: int = 1536
    openai_live_stt_model: str = "gpt-live-transcribe"
    openai_batch_stt_model: str = "gpt-transcribe"


@lru_cache
def settings():
    return Settings()
