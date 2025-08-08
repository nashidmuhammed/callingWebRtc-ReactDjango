from channels.db import database_sync_to_async
from django.contrib.auth.models import AnonymousUser
from rest_framework_simplejwt.tokens import AccessToken
from django.contrib.auth.models import User

@database_sync_to_async
def get_user(token):
    print(f"Validating token: {token[:20]}...")  # Debug
    try:
        access_token = AccessToken(token)
        user_id = access_token['user_id']
        print(f"Token payload: {access_token.payload}")
        user = User.objects.get(id=user_id)
        print(f"User found: {user.username} (ID: {user_id})")
        return user
    except AccessToken.InvalidToken as e:
        print(f"Invalid token error: {e}")
        return AnonymousUser()
    except User.DoesNotExist:
        print(f"User not found for user_id: {user_id}")
        return AnonymousUser()
    except Exception as e:
        print(f"Unexpected error: {e}")
        return AnonymousUser()

class TokenAuthMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        query_string = scope.get('query_string', b'').decode()
        print(f"Query string: {query_string}")
        token = None
        for param in query_string.split('&'):
            if param.startswith('token='):
                token = param[len('token='):]
                break
        if not token:
            print("No token provided")
        scope['user'] = await get_user(token) if token else AnonymousUser()
        return await self.app(scope, receive, send)