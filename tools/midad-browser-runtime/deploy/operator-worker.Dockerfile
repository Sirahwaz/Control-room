FROM mcr.microsoft.com/playwright/python:v1.55.0-noble

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    MIDAD_BROWSER_ACCOUNT_REGISTRY=/var/lib/midad-browser/accounts.json \
    MIDAD_OPERATOR_POLL_SECONDS=3

WORKDIR /app

COPY requirements.txt ./requirements.txt
RUN python -m pip install --no-cache-dir -r requirements.txt

COPY runner.py agent_policy.py account_registry.py secret_provider.py operator_command_router.py persistent_session.py operator_worker.py submit_operator_command.py ./

RUN useradd --create-home --uid 10001 midad \
    && mkdir -p /var/lib/midad-browser \
    && chown -R midad:midad /app /var/lib/midad-browser

USER midad

CMD ["python", "operator_worker.py"]
