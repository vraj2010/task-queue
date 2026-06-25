from pydantic import BaseModel, Field
from typing import Any
from datetime import datetime


class JobRequest(BaseModel):
    handler: str
    payload: dict[str, Any] = {}
    priority: int = Field(default=0, ge=0, le=10)
    queue: str = "default"
    delay_seconds: int = Field(default=0, ge=0)


class JobResponse(BaseModel):
    job_id: str
    status: str
    handler: str
    queue: str
    priority: int
    created_at: datetime