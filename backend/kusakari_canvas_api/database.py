from sqlalchemy import Engine, create_engine, event

from .config import Settings


def create_database_engine(settings: Settings) -> Engine:
    connect_args = {"connect_timeout": 10, "read_timeout": 30, "write_timeout": 30}
    if settings.db_ca:
        connect_args.update(ssl_ca=settings.db_ca, ssl_verify_cert=True, ssl_verify_identity=True)
    engine = create_engine(settings.database_url, pool_pre_ping=True, pool_recycle=3600,
                           pool_size=settings.pool_size, max_overflow=0, pool_timeout=10,
                           connect_args=connect_args, hide_parameters=True)

    @event.listens_for(engine, "connect")
    def utc_session(connection, _record):
        with connection.cursor() as cursor:
            cursor.execute("SET time_zone = '+00:00'")

    return engine
