# keycloak-magic-link-0.84.jar

Расширение [p2-inc/keycloak-magic-link](https://github.com/p2-inc/keycloak-magic-link), тег
`v0.84`, пересобранное под нашу версию Keycloak (26.7.2) — базовый `pom.xml` тега целится в
`26.6.3`.

## Как воспроизвести

```sh
git clone https://github.com/p2-inc/keycloak-magic-link.git
cd keycloak-magic-link
git checkout v0.84
mvn -Dkeycloak.version=26.7.2 -DskipTests package
```

Собранный jar лежит в `target/keycloak-magic-link-0.84.jar`.

```
sha256sum target/keycloak-magic-link-0.84.jar
eb0ec5c02f7e1eed18d3125b425ab2af243ca63329cf0c4ecba777b8bf27b1be  target/keycloak-magic-link-0.84.jar
```

182036 байт. Проверено на Keycloak 26.7.2: грузится в `/opt/keycloak/providers/` без ошибок
(только штатные `WARN` вида «implementing internal SPI»).

## Дальше

- `configMapGenerator` в `kustomization.yaml` берёт этот файл (`binaryData`, 182 КБ — укладывается
  в лимит ConfigMap 1 МиБ), `deploy/patch-keycloak.yaml` монтирует его в
  `/opt/keycloak/providers/keycloak-magic-link-0.84.jar` через `subPath`.
- Тесный лимит здесь не 1 МиБ, а аннотации: клиентский `kubectl apply` кладёт весь объект
  в `kubectl.kubernetes.io/last-applied-configuration`, а на все аннотации объекта даётся
  262144 байта. ConfigMap с jar в base64 занимает около 249,8 КБ — запас примерно 12 КБ,
  то есть jar может вырасти лишь на ~9 КБ (base64 раздувает в 4/3). Дальше `apply` упадёт
  с `metadata.annotations: Too long`, и jar придётся доставлять иначе: `kubectl apply
  --server-side` (не пишет last-applied), init-контейнером или своим образом Keycloak.
