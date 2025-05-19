import createModule from "../wav_ai.js";
import config from "./constants.js";

const Module = await createModule();

self.onmessage = (e) => {
  console.log("[worker][onmessage]: ", e.data);
  const { functionName, channelId, param } = e.data;
  if (functionName === config.CMD_LLM_INIT) {
    (async () => {
      const modelName = param[0];
      const sysPrompt = param[1];
      console.log("[worker][onmessage]", modelName, sysPrompt);
      const result = await avllmInitialize(modelName, sysPrompt);
      console.log("[worker][avllm_get_text] post a message");
      postMessage({ functionName, channelId, result: { status: result } });
    })();
  } else if (functionName === config.CMD_LLM_GEN_START) {
    console.log("[worker][avllm_gen_start - ", param);
    const msg = param[0];
    const buffer = new TextEncoder().encode(msg);
    // const buffer = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x00]); // 'Hello'
    // const buffer = param[0];
    {
      const ptr = Module._malloc(buffer.length);
      Module.HEAPU8.set(buffer, ptr);
      const result = Module.ccall(
        config.CMD_LLM_GEN_START,
        ["number"],
        ["number", "number"],
        [ptr, buffer.length]
      );
      Module._free(ptr);
      if (result < 0) {
        console.log("[worker][avllm_get_text] post a message");
        postMessage({ functionName, channelId, result: { status: false } });
        return;
      }
    }
    {
      console.log("[worker][avllm_gen_get");
      const ptr = Module._malloc(20);
      for (let i = 0; i < 1024; i++) {
        const result = Module.ccall(
          config.CMD_LLM_GEN_GET,
          ["number"],
          ["number", "number"],
          [ptr, 20]
        );
        if (result < 0) {
          break;
        }

        postMessage({
          functionName,
          channelId,
          result: { status: true, data: Module.UTF8ToString(ptr) },
        });
      }
      postMessage({ functionName, channelId, result: { status: false } });
      Module._free(ptr);
    }
  }
};

// Sanity check the workin gof Module
if (!Module.FS.analyzePath("/data").exists) {
  console.log("[debug-01-01]");
  Module.FS.mkdir("/data");
}

// // Write file in MEMFS from JS
Module.FS.writeFile("/data/hello.txt", "Hello from JavaScript!");

// console.log("[debug-03]");
Module.ccall("read_file");

function avllmInitialize(modelName, sysMsgPrompt = "") {
  return new Promise((resolve, reject) => {
    const request_db = indexedDB.open(config.INDEXED_DB_NAME, 1);
    // const modelName = selectModel.options[selectModel.selectedIndex].text;

    request_db.onupgradeneeded = (event) => {
      console.log("[read][onupgradeneeded] is called.");
    };

    request_db.onsuccess = (event) => {
      console.log("[read][onsuccess] is called.");
      const db = event.target.result;
      const transaction = db.transaction("gguf", "readonly");
      const object = transaction.objectStore("gguf");

      const getRequestStoreObj = object.get(modelName);

      getRequestStoreObj.onsuccess = function () {
        const data = getRequestStoreObj.result;
        if (data) {
          const blob = new Blob([data["value"]], {
            type: "application/octet-stream",
          });

          blob.arrayBuffer().then((arrayBuffer) => {
            console.log("[DEBUG] call me here");
            const uint8Array = new Uint8Array(arrayBuffer);

            Module.FS.writeFile("/data/bin", uint8Array, {
              canOwn: true,
            });

            // apply template if any

            // const message =
            //   "<|system|>\nyou are helpful assistant</s>\n<|user|>\n";

            const ptr =
              sysMsgPrompt.length > 0 ? Module._malloc(sysMsgPrompt.length) : 0;

            if (ptr) Module.HEAPU8.set(sysMsgPrompt, ptr);

            const ret = Module.ccall(
              config.CMD_LLM_INIT,
              "number",
              ["number", "number"],
              [ptr, sysMsgPrompt.length]
            );

            if (ptr) Module._free(ptr);

            resolve(ret < 0 ? false : true);
          });
        } else {
          resolve(false);
          console.error("[Error][can not get data]");
        }
      };
    };

    request_db.onerror = (event) => {
      console.log("[read][onerror] is called.");
    };
  });
}
