# Контракт MVP P0

Маршруты используют JSON. Кроме списка тестовых профилей, запросы требуют `Authorization: Bearer <token>`. Фиксированные токены предназначены для локальной демонстрации на синтетических данных. Для реального внедрения требуется корпоративная идентификация.

| Запрос | Тело | Ответ |
|---|---|---|
| `GET /api/session` | — | `{users:[{token,id,name,role,team_id}]}` |
| `GET /api/me` | — | Профиль текущего пользователя |
| `GET /api/tasks` | — | `{tasks:[{id,title,description,period,assigned_role,status,source_row,completed_at,document_ids,request_ids}]}` |
| `PATCH /api/tasks/{id}` | `{status}` | Обновлённая задача |
| `GET /api/knowledge` | — | `{documents:[{id,title,content,source_type}]}` |
| `POST /api/chat` | `{message}` | `{answer,sources:[{id,title}],mode,action}` |
| `GET /api/requests` | — | `{requests:[Request]}` |
| `POST /api/requests` | `{resource,reason}` | `{request:Request}` |
| `POST /api/requests/{id}/confirm` | `{confirmed:true}` | `{request:Request}` |
| `POST /api/demo/requests/{id}/grant` | `{confirmed:true}` | `{request:Request}` |

`GET /api/tasks` дополнительно возвращает `first_task` для стажёра. Состояния: `blocked` до отправки, `waiting` после отправки и `ready` после события выдачи доступа. Демонстрационное событие разрешено только владельцу уже отправленной тестовой заявки и повторяется без изменения номера.

`Request` содержит `id`, `resource`, `reason`, `status`, `ticket_id` и `next_step`. Поле `action` равно `null` или `{resource:"team_workspace"}`. API возвращает ошибки в поле `detail`. Стажёр работает только со своими заявками и задачами. При чтении инструкций и перед вызовом модели сервер фильтрует данные по роли и контексту команды.

Создание черновика не вызывает сервис. Явное подтверждение запускает тестовую операцию и сохраняет результат. Повтор подтверждения возвращает тот же номер. Для проверки сбоя используйте `[fail-once]` в обосновании. Сбой оставляет возможность повторить отправку. Статус отправки отражает приём заявки тестовым сервисом. Он не подтверждает предоставление доступа.
