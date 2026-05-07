lab7/
├── docker-compose.yml
├── docker-compose.observability.yml   
│
├── todo-app/
│   ├── backend/
│   │   ├── server.js          
│   │   ├── package.json      
│   │   ├── Dockerfile
│   │   └── .dockerignore
│   ├── frontend/
│   │   ├── src/App.js
│   │   ├── public/index.html
│   │   ├── package.json
│   │   ├── Dockerfile
│   │   └── nginx.conf
│   └── k8s/kustomize/
│       ├── base/             
│       └── overlays/dev/
│
├── todo-infrastructure/       
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
