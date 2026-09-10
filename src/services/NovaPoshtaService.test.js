import test from "node:test";
import assert from "node:assert/strict";

import {
  createNovaPoshtaService,
} from "./NovaPoshtaService.js";

function response(data) {
  return {
    ok: true,
    async json() {
      return { success: true, data };
    },
  };
}

test("знаходить міста та не передає ключ клієнту", async () => {
  const requests = [];
  const service = createNovaPoshtaService({
    apiKey: "server-secret",
    fetchImpl: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return response([
        {
          Ref: "city-1",
          Description: "Київ",
          DescriptionRu: "Киев",
          AreaDescription: "Київська",
          AreaDescriptionRu: "Киевская",
          SettlementTypeDescription: "місто",
          SettlementTypeDescriptionRu: "город",
        },
      ]);
    },
  });

  const cities = await service.searchCities(" Київ ", {
    locale: "ru",
  });

  assert.deepEqual(cities, [
    {
      ref: "city-1",
      name: "Киев",
      displayName: "Киев (город, Киевская)",
      area: "Киевская",
      settlementType: "город",
    },
  ]);
  assert.equal(requests[0].body.apiKey, "server-secret");
  assert.equal(requests[0].body.calledMethod, "getCities");
  assert.equal(requests[0].body.methodProperties.FindByString, "Київ");
  assert.equal("apiKey" in cities[0], false);

  await service.searchCities("Київ", { locale: "ru" });
  assert.equal(requests.length, 1);
});

test("повертає відділення та поштомати у форматі оформлення", async () => {
  const service = createNovaPoshtaService({
    apiKey: "server-secret",
    fetchImpl: async () => response([
      {
        Ref: "branch-12",
        Description: "Відділення №12: вул. Хрещатик, 1",
        ShortAddress: "вул. Хрещатик, 1",
        Number: "12",
        CategoryOfWarehouse: "Branch",
        PostalCodeUA: "01001",
      },
      {
        Ref: "locker-77",
        Description: "Поштомат №77: вул. Велика, 2",
        ShortAddress: "вул. Велика, 2",
        Number: "77",
        CategoryOfWarehouse: "Postomat",
      },
    ]),
  });

  const points = await service.searchPoints("city-1", "12");

  assert.equal(points[0].type, "BRANCH");
  assert.equal(points[0].number, "12");
  assert.equal(points[0].postalCode, "01001");
  assert.equal(points[1].type, "LOCKER");
});

test("пояснює відсутність серверного API-ключа", async () => {
  const service = createNovaPoshtaService({ apiKey: "" });

  await assert.rejects(
    service.searchCities("Київ"),
    (error) => {
      assert.equal(error.statusCode, 503);
      assert.equal(error.code, "NOVA_POSHTA_NOT_CONFIGURED");
      return true;
    }
  );
});

