"""Scoped E2E fixture: inspect persistence or reproduce one legacy invalid anchor."""
import argparse
import json
import os
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from kusakari_canvas_api.config import Settings
from kusakari_canvas_api.database import create_database_engine
from kusakari_canvas_api.models import Garden, PlacedObject


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('garden_id', type=UUID)
    parser.add_argument('--legacy', action='store_true')
    args = parser.parse_args()
    os.environ['KUSAKARI_CANVAS_PROFILE'] = 'e2e'
    settings = Settings.from_env()
    if not settings.database_url.database.startswith('kusakari_canvas_e2e'):
        raise ValueError('Dedicated E2E database required')
    engine = create_database_engine(settings)
    with Session(engine) as session, session.begin():
        garden = session.get(Garden, str(args.garden_id))
        if not garden or garden.owner_id != settings.owner_id or not garden.name.startswith('E2E placement '):
            raise ValueError('Only this suite fixture may be inspected or modified')
        objects = list(session.scalars(select(PlacedObject).where(PlacedObject.garden_id == garden.id)
                                       .order_by(PlacedObject.id)))
        if args.legacy:
            if len(objects) != 1:
                raise ValueError('Single-object fixture required')
            objects[0].position_x = 1
            objects[0].position_z = -1
            session.flush()
        print(json.dumps({'revision': garden.revision, 'updatedAt': garden.updated_at.isoformat(),
                          'objects': [{'id': o.id, 'x': o.position_x, 'z': o.position_z} for o in objects]}))
    engine.dispose()


if __name__ == '__main__':
    main()
