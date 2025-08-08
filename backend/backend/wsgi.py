# import os
# from django.core.wsgi import get_wsgi_application
# from socket_server import app as socketio_app

# os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')

# application = socketio_app

import os
from django.core.wsgi import get_wsgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')

application = get_wsgi_application()