# Лабораторная работа №7 — Observability (Prometheus, Grafana, Tempo)

## Структура проекта

```
lab7/
├── docker-compose.yml                  # Приложение + БД
├── docker-compose.observability.yml    # Overlay: Prometheus + Grafana + Tempo
│
├── todo-app/
│   ├── backend/
│   │   ├── server.js          ← + /metrics (prom-client) + OpenTelemetry
│   │   ├── package.json       ← + prom-client, @opentelemetry/*
│   │   ├── Dockerfile
│   │   └── .dockerignore
│   ├── frontend/
│   │   ├── src/App.js
│   │   ├── public/index.html
│   │   ├── package.json
│   │   ├── Dockerfile
│   │   └── nginx.conf
│   └── k8s/kustomize/
│       ├── base/              ← backend-deployment с OTLP env + аннотации scrape
│       └── overlays/dev/
│
├── todo-infrastructure/       ← из лаб.6 (без изменений)
│   ├── helm/postgres-redis-chart/
│   └── kustomize/base + overlays/dev/
│
└── todo-observability/
    ├── docker-compose/
    │   ├── prometheus/prometheus.yml
    │   ├── tempo/tempo.yaml
    │   └── grafana/
    │       ├── provisioning/datasources/datasources.yaml
    │       ├── provisioning/dashboards/dashboards.yaml
    │       └── dashboards/lab7-todo.json
    └── k8s/
        ├── tempo.yaml          ← Namespace + ConfigMap + Deployment + Service
        └── service-monitor.yaml ← ServiceMonitor для Prometheus Operator
```

---

## Часть A — Docker Compose (локально)

### Запуск приложения + стека наблюдаемости

```bash
# Поднять всё вместе
docker compose -f docker-compose.yml -f docker-compose.observability.yml up -d

# Проверить статус
docker compose -f docker-compose.yml -f docker-compose.observability.yml ps
```

### Проверка

| Сервис | URL |
|--------|-----|
| Frontend | http://localhost:3000 |
| Backend API | http://localhost:5000/api/health |
| **Метрики** | http://localhost:5000/metrics |
| Prometheus | http://localhost:9090 → Status → Targets |
| **Grafana** | http://localhost:3001 (admin / admin) |
| Tempo API | http://localhost:3200 |

### Генерация нагрузки

```bash
# Создать задачи
curl -X POST http://localhost:5000/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"Настроить Prometheus"}'

curl -X POST http://localhost:5000/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"Построить дашборд Grafana"}'

# Получить задачи (несколько раз — увидим cache vs database)
for i in {1..10}; do curl -s http://localhost:5000/api/tasks | jq .source; done
```

В Grafana → папка **Lab7** → дашборд **Todo App — Lab7**:
- HTTP RPS по маршрутам
- Латентность p99/p50
- Бизнес-метрики: число активных/завершённых задач
- Rate ошибок 5xx

В Grafana → Explore → Tempo: найти трейсы по запросам к `/api/tasks`.

---

## Часть B — Kubernetes

### Шаг 1: Инфраструктура (из лаб.6)

```bash
helm upgrade --install postgres-redis \
  ./todo-infrastructure/helm/postgres-redis-chart \
  --namespace todo-dev --create-namespace \
  -f ./todo-infrastructure/helm/postgres-redis-chart/values-dev.yaml
```

### Шаг 2: Стек наблюдаемости

```bash
# Tempo
kubectl apply -f todo-observability/k8s/tempo.yaml

# kube-prometheus-stack (Prometheus Operator + Grafana)
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update
helm upgrade --install kube-prometheus-stack prometheus-community/kube-prometheus-stack \
  --namespace observability --create-namespace \
  --set grafana.adminPassword=admin
```

### Шаг 3: Приложение

```bash
# Сборка образов (Docker Desktop)
docker build -t todo-backend:latest  ./todo-app/backend
docker build -t todo-frontend:latest ./todo-app/frontend

# Применить манифесты
kubectl apply -k todo-app/k8s/kustomize/overlays/dev

# ServiceMonitor
kubectl apply -f todo-observability/k8s/service-monitor.yaml
```

### Шаг 4: Доступ

```bash
kubectl port-forward svc/frontend 3000:80 -n todo-dev
kubectl port-forward svc/kube-prometheus-stack-grafana 3001:80 -n observability
kubectl port-forward svc/kube-prometheus-stack-prometheus 9090:9090 -n observability
```

### Переменные OTLP в Deployment (уже вшиты в base/backend-deployment.yaml)

| Переменная | Значение |
|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://tempo.observability.svc.cluster.local:4318` |
| `OTEL_SERVICE_NAME` | `todo-backend` |

---

## Метрики (PromQL примеры)

```promql
# RPS по маршрутам
sum(rate(http_requests_total{job="todo-backend"}[1m])) by (route, status_code)

# Латентность p99
histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket[1m])) by (le, route))

# Бизнес-метрика: активные задачи
todo_tasks_total{status="active"}

# Бизнес-метрика: скорость создания задач
rate(todo_tasks_created_total[2m])

# Ошибки 5xx
sum(rate(http_requests_total{status_code=~"5.."}[1m]))
```


