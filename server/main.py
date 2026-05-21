import uvicorn
from api.app import sio_app

if __name__ == "__main__":
    uvicorn.run("api.app:sio_app", host="0.0.0.0", port=3000, reload=True)
