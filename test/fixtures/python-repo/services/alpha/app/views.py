from app import db


def index():
    return db["engine"]
