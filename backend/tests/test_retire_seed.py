"""Le retrait des recettes embarquées qui ne sont plus dans le seed.

Ce test tourne sans serveur, sur une base simulée. La logique est destructrice
— elle supprime des documents et leurs j'aime — et une régression coûterait des
recettes de la communauté : elle mérite d'être exercée directement plutôt qu'à
travers l'API.

Les coroutines sont lancées par `asyncio.run` plutôt que par un greffon pytest :
une dépendance de moins pour quatre tests.
"""
import asyncio
import os
import sys
from pathlib import Path

from mongomock_motor import AsyncMongoMockClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# `server` ouvre sa connexion au chargement du module : on lui donne une base
# simulée avant de l'importer, sinon il faudrait un vrai MongoDB pour tester une
# fonction qui n'a besoin que de deux collections.
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "bakers_retire_test")
os.environ.setdefault("JWT_SECRET", "test-secret")
import motor.motor_asyncio  # noqa: E402

motor.motor_asyncio.AsyncIOMotorClient = lambda *a, **kw: AsyncMongoMockClient()

from server import retire_built_ins  # noqa: E402


def fresh_db():
    return AsyncMongoMockClient()["retire"]


def test_retire_une_fiche_absente_du_seed():
    async def run():
        db = fresh_db()
        await db.recipes.insert_many([
            {"id": "a", "title": "Encore au catalogue", "is_user_submitted": False},
            {"id": "b", "title": "Retirée du seed", "is_user_submitted": False},
        ])
        removed = await retire_built_ins(db.recipes, [db.likes], {"Encore au catalogue"})
        assert removed == ["Retirée du seed"]
        assert [r["id"] async for r in db.recipes.find({})] == ["a"]
    asyncio.run(run())


def test_une_recette_de_la_communaute_est_intouchable():
    # Le cas qui compte : une recette partagée par un membre ne figure jamais
    # dans le seed, donc rien ne la distingue d'une fiche retirée sinon son
    # drapeau.
    async def run():
        db = fresh_db()
        await db.recipes.insert_one(
            {"id": "c", "title": "Le pain de Lucas", "is_user_submitted": True})
        assert await retire_built_ins(db.recipes, [db.likes], {"Autre chose"}) == []
        assert await db.recipes.count_documents({"id": "c"}) == 1
    asyncio.run(run())


def test_les_lignes_orphelines_partent_avec_la_fiche():
    async def run():
        db = fresh_db()
        await db.recipes.insert_one(
            {"id": "b", "title": "Retirée", "is_user_submitted": False})
        await db.likes.insert_many([
            {"recipe_id": "b", "user_id": "u1"},
            {"recipe_id": "autre", "user_id": "u1"},
        ])
        await db.comments.insert_one({"recipe_id": "b", "content": "miam"})
        await retire_built_ins(db.recipes, [db.likes, db.comments], set())
        assert await db.likes.count_documents({"recipe_id": "b"}) == 0
        # Les j'aime d'une autre recette ne sont pas emportés au passage.
        assert await db.likes.count_documents({"recipe_id": "autre"}) == 1
        assert await db.comments.count_documents({}) == 0
    asyncio.run(run())


def test_un_seed_inchange_ne_supprime_rien():
    async def run():
        db = fresh_db()
        await db.recipes.insert_one(
            {"id": "a", "title": "Croissant au beurre", "is_user_submitted": False})
        assert await retire_built_ins(db.recipes, [db.likes], {"Croissant au beurre"}) == []
        assert await db.recipes.count_documents({}) == 1
    asyncio.run(run())
