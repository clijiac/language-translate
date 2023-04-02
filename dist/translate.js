import googleTranslate from "@vitalets/google-translate-api";
import baiduTranslater from "baidu-fanyi";
import tunnel from "tunnel";
import { ls } from "./locales.js";
import { consoleError, consoleLog, consoleSuccess, consoleWarn, createJsonBuffer, getBaiduLangCode, isFilePath, mergeJson, } from "./utils.js";
import { TranslateService, } from "./types.js";
import fs from "fs";
import path from "path";
export const translate = async ({ input, output, fromLang, targetLang, toolsLang = "zh-CN", proxy, apiKeyConfig, }) => {
    if (!isFilePath(input)) {
        return;
    }
    const translator = (key) => {
        if (apiKeyConfig) {
            switch (apiKeyConfig.type) {
                case TranslateService.baidu:
                    const bTranslator = new baiduTranslater(apiKeyConfig.appId, apiKeyConfig.appKey);
                    return baiduTranslator(key, bTranslator);
                default:
                    break;
            }
        }
        return googleTranslator(key);
    };
    const googleTranslator = (key) => new Promise((resolve, reject) => {
        let failedNum = 0;
        const run = () => {
            googleTranslate(key, { from: fromLang, to: targetLang }, proxy
                ? {
                    agent: tunnel.httpsOverHttp({
                        proxy: {
                            host: proxy.host,
                            port: proxy.port,
                            headers: {
                                "User-Agent": "Node",
                            },
                        },
                    }),
                }
                : undefined)
                .then(({ text }) => {
                resolve(text);
            })
                .catch((err) => {
                if (++failedNum > 10) {
                    consoleError(ls[toolsLang].checkNetwork);
                    reject(err);
                }
                else {
                    consoleWarn(ls[toolsLang].retry);
                    setTimeout(() => {
                        run();
                    }, 1000);
                }
            });
        };
        run();
    });
    const baiduTranslator = (key, baiduTranslater) => {
        return new Promise((resolve, reject) => {
            let failedNum = 0;
            const run = () => {
                baiduTranslater
                    .translate(key, {
                    // @ts-ignore
                    from: getBaiduLangCode(fromLang),
                    // @ts-ignore
                    to: getBaiduLangCode(targetLang),
                })
                    .then((text) => {
                    resolve(text);
                })
                    .catch((err) => {
                    if (++failedNum > 10) {
                        consoleError(ls[toolsLang].checkNetwork);
                        consoleError(err);
                        reject(err);
                    }
                    else {
                        consoleWarn(ls[toolsLang].retry);
                        consoleError(err);
                        setTimeout(() => {
                            run();
                        }, 1000);
                    }
                });
            };
            run();
        });
    };
    let inputStartStr = "";
    // ------readSourceJson start-------
    let sourceText;
    try {
        sourceText = fs.readFileSync(input, "utf8");
        if (sourceText.includes("export")) {
            inputStartStr = sourceText.slice(0, sourceText.indexOf("export"));
            sourceText = sourceText.slice(sourceText.indexOf("export"));
        }
        inputStartStr += sourceText.slice(0, sourceText.indexOf("{"));
    }
    catch (error) {
        consoleError(ls[toolsLang].checkFromPath + "\n path ---> " + input + "\n" + error);
        return;
    }
    sourceText = sourceText.slice(sourceText.indexOf("{"), sourceText.lastIndexOf("}") + 1);
    let sourceJson = {};
    sourceText = "sourceJson = " + sourceText;
    try {
        eval(`(${sourceText})`);
    }
    catch (error) {
        consoleError(ls[toolsLang].sourceErr + "\npath ---> " + input + "\n" + error);
        return;
    }
    if (Object.keys(sourceJson).length === 0) {
        consoleError(ls[toolsLang].sourceNull);
        return;
    }
    // ------readSourceJson end-------
    const translateRun = async (jsonObj) => {
        const resJsonObj = {};
        for (const key in jsonObj) {
            const text = jsonObj[key];
            if (typeof text === "string") {
                let resText = "";
                if (/\{\{.+?\}\}/.test(text)) {
                    const texts = text.split(/\{\{.+?\}\}/g);
                    const slots = [];
                    text.replace(/\{\{.+?\}\}/g, (v) => {
                        slots.push(v);
                        return "";
                    });
                    for (let i = 0; i < texts.length; i++) {
                        const text = texts[i];
                        if (text) {
                            const resFragment = await translator(text);
                            texts[i] = resFragment;
                        }
                    }
                    for (let j = 0; j < texts.length; j++) {
                        const str = texts[j];
                        resText += str;
                        if (j < texts.length - 1) {
                            resText += slots[j];
                        }
                    }
                }
                else {
                    resText = await translator(text);
                }
                consoleSuccess(`${fromLang}: ${text} ---> ${targetLang}: ${resText}`);
                resJsonObj[key] = resText;
            }
            else {
                resJsonObj[key] = await translateRun(text);
            }
        }
        return resJsonObj;
    };
    const resJson = await translateRun(sourceJson);
    // ------read out json start-----
    let startStr = "";
    const funValues = [];
    let outFile;
    let outTextJson = {};
    try {
        outFile = fs.readFileSync(output, "utf8");
        try {
            if (outFile.includes("export")) {
                startStr = outFile.slice(0, outFile.indexOf("export"));
                outFile = outFile.slice(outFile.indexOf("export"));
            }
            startStr += outFile.slice(0, outFile.indexOf("{"));
            outFile = outFile.slice(outFile.indexOf("{"), outFile.lastIndexOf("}") + 1);
            outFile = outFile.replace(/['"`a-zA-Z0-9_]+:.*(\(.+\).*=>|function[\s\S]+?return)[\s\S]+?,\n/g, (v) => {
                funValues.push(v);
                return "";
            });
            outFile = "outTextJson = " + outFile;
            eval(`(${outFile})`);
        }
        catch (error) {
            consoleError(ls[toolsLang].targetErr + "\n path ---> " + output + "\n" + error);
            return;
        }
    }
    catch (error) {
        // readFileSync error
    }
    // ------read out json end-----
    let outPutBuffer = (outFile ? startStr : inputStartStr) + "{\n";
    funValues.forEach((item) => {
        outPutBuffer += `\t${item}`;
    });
    if (outFile) {
        outPutBuffer += createJsonBuffer(mergeJson(outTextJson, resJson)).slice(2);
        fs.writeFileSync(output, outPutBuffer);
        consoleLog(`${ls[toolsLang].patchSuccess} --> ${output}`);
    }
    else {
        outPutBuffer += createJsonBuffer(resJson).slice(2);
        const outDirname = path.dirname(output);
        fs.existsSync(outDirname) || fs.mkdirSync(outDirname, { recursive: true });
        fs.writeFileSync(output, outPutBuffer);
        consoleLog(`${ls[toolsLang].createSuccess} --> ${output}`);
    }
};
