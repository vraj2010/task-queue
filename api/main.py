from fastapi import FastAPI

from api.routes import router

app = FastAPI(
    title="Task Queue API",
    version="0.1.0"
)

app.include_router(
    router,
    prefix="/api/v1"
)

@app.get("/")
async def root():
    return {"status": "ok", "service": "task-queue"}