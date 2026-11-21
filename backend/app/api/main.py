from fastapi import APIRouter

from app.api.routes import (
    admin,
    catalog,
    dashboard,
    login,
    master,
    notifications,
    private,
    requests,
    users,
    utils,
)
from app.core.config import settings

api_router = APIRouter()
api_router.include_router(login.router)
api_router.include_router(users.router)
api_router.include_router(utils.router)
api_router.include_router(requests.router)
api_router.include_router(catalog.router)
api_router.include_router(master.router)
api_router.include_router(dashboard.router)
api_router.include_router(notifications.router)
api_router.include_router(admin.router)


if settings.FASTAPI_ENV == "development":
    api_router.include_router(private.router)
