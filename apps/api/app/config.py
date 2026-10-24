from functools import lru_cache
from pydantic_settings import BaseSettings
from pydantic import Field


class Settings(BaseSettings):
    database_url: str = (
        "postgresql+psycopg://lectureloop:local-development-change-before-deploy@localhost:5432/lectureloop"
    )
    app_origin: str = "http://localhost:8080"
    cookie_secure: bool = False
    media_root: str = "/media"
    max_upload_mb: int = 100
    retrieval_timeout_seconds: float = Field(default=20, gt=0, le=20)
    query_embedding_timeout_seconds: float = Field(default=10, gt=0, le=10)
    answer_timeout_seconds: float = Field(default=10, gt=0, le=10)
    ocr_model_root: str = "/opt/lectureloop/models"
    bsl_enabled: bool = False
    bsl_kozha_url: str = "http://kozha:8000"
    openai_api_key: str = ""
    openai_base_url: str = "https://api.openai.com/v1"
    openai_text_model: str = "gpt-4.1-mini"
    openai_diagram_model: str = "gpt-4.1-mini"
    diagram_timeout_seconds: float = Field(default=120, gt=0, le=180)
    openai_embed_model: str = "text-embedding-3-small"
    openai_embed_dimensions: int = 1536
    openai_live_stt_model: str = "gpt-live-transcribe"
    openai_batch_stt_model: str = "gpt-transcribe"


@lru_cache
def settings():
    return Settings()
