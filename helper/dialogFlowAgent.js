'use strict';
const _ = require('lodash');
const fs = require('fs');
const DialogFlowUtil = require('./dialogflowUtil');
const BUILTIN_PREFIX = '@sys.';
const pathSep = require('path').sep;

/**
 * Class DialogFlowAgent
 */
class DialogFlowAgent {
    /**
     * Constructor
     * Config with locale information
     * @param {*} config
     */
    constructor(config) {
        this.config = config;
    }


    /**
     * Creates files (agent, intents, entities)
     * @param {*} model jovoModel
     */
    transform(model) {
        // create dialog flow folder
        if (!fs.existsSync(DialogFlowUtil.getPath())) {
            fs.mkdirSync(DialogFlowUtil.getPath());
        }

        if (!fs.existsSync(DialogFlowUtil.getIntentsFolderPath())) {
            fs.mkdirSync(DialogFlowUtil.getIntentsFolderPath());
        }

        // take primary language from locales
        let primLanguage = require('./lmHelper').Project.getLocales().filter((lang) => {
            return this.config.locale.substr(0, 2) === lang.substr(0, 2);
        });
        let outputLocale = this.config.locale.toLowerCase();
        if (primLanguage.length === 1) {
            outputLocale = this.config.locale.substr(0, 2);
        }
        // throw Error(outputLocale);


        for (let intent of model.intents) {
            let intentPath = DialogFlowUtil.getIntentsFolderPath() + intent.name + '.json';
            let dfIntentObj = {
                'name': intent.name,
                'auto': true,
                'webhookUsed': true,
            };

            // handle intent inputs
            if (intent.inputs) {
                dfIntentObj.responses = [{
                    parameters: [],
                }];

                for (let input of intent.inputs) {
                    let parameterObj = {
                        isList: false,
                        name: input.name,
                        value: '$' + input.name,
                    };
                    if (typeof input.type === 'object') {
                        if (input.type.dialogflow) {
                            if (_.startsWith(input.type.dialogflow, BUILTIN_PREFIX)) {
                                parameterObj.dataType = input.type.dialogflow;
                            } else {
                                input.type = input.type.dialogflow;
                            }
                        } else {
                            throw new Error('Please add a dialogflow property for input "'+input.name+'"');
                        }
                    }
                    // handle custom input types
                    if (!parameterObj.dataType) {
                        if (!input.type) {
                            throw new Error('Invalid input type in intent "' + intent.name + '"');
                        }
                        parameterObj.dataType = input.type;
                        // throw error when no inputTypes object defined
                        if (!model.inputTypes) {
                            throw new Error('Input type "' + parameterObj.dataType + '" must be defined in inputTypes');
                        }

                        // find type in global inputTypes array
                        let matchedInputTypes = model.inputTypes.filter((item) => {
                            return item.name === parameterObj.dataType;
                        });

                        parameterObj.dataType = '@' + parameterObj.dataType;


                        if (matchedInputTypes.length === 0) {
                            throw new Error('Input type "' + parameterObj.dataType + '" must be defined in inputTypes');
                        }

                        // create entities folders + files
                        if (!fs.existsSync(DialogFlowUtil.getEntitiesFolderPath())) {
                            fs.mkdirSync(DialogFlowUtil.getEntitiesFolderPath());
                        }
                        // create alexaTypeObj from matched input types
                        for (let matchedInputType of matchedInputTypes) {
                            let dfEntityObj = {
                                name: matchedInputType.name,
                                isOverridable: true,
                                isEnum: false,
                                automatedExpansion: false,
                            };
                            let entityFilePath = DialogFlowUtil.getEntitiesFolderPath() + matchedInputType.name + '.json';
                            fs.writeFileSync(entityFilePath,
                                JSON.stringify(dfEntityObj, null, '\t')
                            );

                            let entityValues = [];
                            // create dfEntityValueObj
                            for (let value of matchedInputType.values) {
                                let dfEntityValueObj = {
                                    value: value.value,
                                    synonyms: [value.value],
                                };

                                // save synonyms, if defined
                                if (value.synonyms) {
                                    dfEntityValueObj.synonyms = dfEntityValueObj.synonyms.concat(
                                        value.synonyms);
                                }
                                entityValues.push(dfEntityValueObj);
                            }
                            let entityEntriesFilePath = DialogFlowUtil.getEntitiesFolderPath() + matchedInputType.name + '_entries_' + outputLocale + '.json';
                            fs.writeFileSync(entityEntriesFilePath,
                                JSON.stringify(entityValues, null, '\t')
                            );
                        }
                    }

                    dfIntentObj.responses[0].parameters.push(parameterObj);
                }
            }

            if (_.get(intent, 'dialogflow')) {
                _.merge(dfIntentObj, intent.dialogflow);
            }

            fs.writeFileSync(intentPath, JSON.stringify(dfIntentObj, null, '\t'));

            // dialogflow intents form locale.json
            if (_.get(model, 'dialogflow.intents')) {
                for (let modelDialogflowIntent of _.get(model, 'dialogflow.intents')) {
                    let path = DialogFlowUtil.getIntentsFolderPath() + pathSep + modelDialogflowIntent.name + '.json';
                    fs.writeFileSync(path, JSON.stringify(modelDialogflowIntent, null, '\t'));
                    // user says
                    if (modelDialogflowIntent.userSays) {
                        let pathUserSays = DialogFlowUtil.getIntentsFolderPath() + pathSep + modelDialogflowIntent.name + '_usersays_'+ outputLocale + '.json';
                        fs.writeFileSync(pathUserSays, JSON.stringify(modelDialogflowIntent.userSays, null, '\t'));
                        delete modelDialogflowIntent.userSays;
                    }
                }
            }

            // dialogflow entities form locale.json
            if (_.get(model, 'dialogflow.entities')) {
                // create entities folders + files
                if (!fs.existsSync(DialogFlowUtil.getEntitiesFolderPath())) {
                    fs.mkdirSync(DialogFlowUtil.getEntitiesFolderPath());
                }
                for (let modelDialogflowEntity of _.get(model, 'dialogflow.entities')) {
                    let path = DialogFlowUtil.getEntitiesFolderPath() + pathSep + modelDialogflowEntity.name + '.json';
                    fs.writeFileSync(path, JSON.stringify(modelDialogflowEntity, null, '\t'));
                    // entries
                    if (modelDialogflowEntity.entries) {
                        let pathEntries = DialogFlowUtil.getEntitiesFolderPath() + pathSep + modelDialogflowEntity.name + '_usersays_'+ outputLocale + '.json';
                        fs.writeFileSync(pathEntries, JSON.stringify(modelDialogflowEntity.entries, null, '\t'));
                        delete modelDialogflowEntity.entries;
                    }
                }
            }

            // handle user says files for intent

            let dialogFlowIntentUserSays = [];
            let re = /{(.*?)}/g;

            // iterate through phrases and intent user says data objects
            for (let phrase of intent.phrases) {
                let m;
                let data = [];
                let pos = 0;
                while (m = re.exec(phrase)) {
                    // text between entities
                    let text = phrase.substr(pos, m.index - pos);

                    // entities
                    let entity = phrase.substr(m.index + 1, m[1].length);

                    pos = m.index + 1 + m[1].length + 1;


                    let dataTextObj = {
                        text: text,
                        userDefined: false,
                    };

                    // skip empty text on entity index = 0
                    if (text.length > 0) {
                        data.push(dataTextObj);
                    }

                    let dataEntityObj = {
                        text: entity,
                        userDefined: true,
                    };

                    // create entity object based on parameters objects
                    if (_.get(dfIntentObj, 'responses[0].parameters')) {
                        dfIntentObj.responses[0].parameters.forEach((item) => {
                            if (item.name === entity) {
                                dataEntityObj.alias = item.name;
                                dataEntityObj.meta = item.dataType;
                            }
                        });
                    }

                    data.push(dataEntityObj);
                }

                // if no entities in phrase use full phrase as data object
                if (data.length === 0) {
                    data = [
                        {
                            text: phrase,
                            userDefined: false,
                        },
                    ];
                }

                dialogFlowIntentUserSays.push({
                    data: data,
                    isTemplate: false,
                    count: 0,
                });
            }
            let intentUserSaysFilePath = DialogFlowUtil.getIntentsFolderPath() + intent.name + '_usersays_' + outputLocale + '.json';
            fs.writeFileSync(intentUserSaysFilePath, JSON.stringify(dialogFlowIntentUserSays, null, '\t'));
        }
    }
}

// let dfa = new DialogFlowAgent({locale: 'en-US'});
// let model = require('./demo/models/en-US.json');
// Helper.setProjectPath('demo');
// dfa.transform(model);
// let aim = new AlexaInteractionModel(alexa);
//
// let model = require('./bla5/models/en-US.json');
// aim.transform(model);
//
// aim.save(function() {
//     console.log('done');
// });


module.exports.DialogFlowAgent = DialogFlowAgent;