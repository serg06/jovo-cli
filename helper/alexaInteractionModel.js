'use strict';
const _ = require('lodash');
const fs = require('fs');
const BUILTIN_PREFIX = 'AMAZON.';

/**
 * Class AlexaInteractionModel
 */
class AlexaInteractionModel {

    /**
     * Constructor
     * @param {*} obj
     */
    constructor(obj) {
        if (obj) {
            Object.assign(this, obj);
        }
    }

    /**
     * Transforms Alexa model to Jovo model
     * @return {*}
     */
    reverse() {
        let jovoModel = {};
        jovoModel.invocation = _.get(this, 'interactionModel.languageModel.invocationName');

        // prompts
        if (_.get(this, 'interactionModel.prompts')) {
            _.set(jovoModel, 'alexa.interactionModel.prompts', _.get(this, 'interactionModel.prompts'));
        }

        // dialog
        if (_.get(this, 'interactionModel.dialog')) {
            _.set(jovoModel, 'alexa.interactionModel.dialog', _.get(this, 'interactionModel.dialog'));
        }

        let alexaIntents = [];
        let jovoIntents = [];
        for (let intent of _.get(this, 'interactionModel.languageModel.intents')) {
            if (_.startsWith(intent.name, BUILTIN_PREFIX)) {
                alexaIntents.push(intent);
            } else {
                let jovoIntent = {
                    name: intent.name,
                    phrases: intent.samples,
                };
                let inputs = [];
                if (intent.slots) {
                    for (let slot of intent.slots) {
                        let input = {
                            name: slot.name,
                        };
                        if (_.startsWith(slot.type, BUILTIN_PREFIX)) {
                            input.type = {
                                alexa: slot.type,
                            };
                        } else {
                            input.type = slot.type;
                        }

                        if (slot.samples) {
                            input.alexa = {
                                samples: slot.samples,
                            };
                        }
                        inputs.push(input);
                    }
                    jovoIntent.inputs = inputs;
                }
                jovoIntents.push(jovoIntent);
            }
        }

        if (_.get(this, 'interactionModel.languageModel.types')) {
            // input types
            let inputTypes = [];
            for (let type of _.get(this, 'interactionModel.languageModel.types')) {
                let values = [];
                for (let typeValue of type.values) {
                    let tV = {
                        value: typeValue.name.value,
                    };
                    if (typeValue.name.synonyms) {
                        tV.synonyms = typeValue.name.synonyms;
                    }
                    if (typeValue.id) {
                        tV.id = typeValue.id;
                    }
                    values.push(tV);
                }
                inputTypes.push({
                    name: type.name,
                    values: values,
                });
            }
            _.set(jovoModel, 'inputTypes', inputTypes);
        }

        _.set(jovoModel, 'alexa.interactionModel.languageModel.intents', alexaIntents);
        _.set(jovoModel, 'intents', jovoIntents);
        return jovoModel;
    }

    /**
     * Transforms jovo model to Alexa model
     * @param {*} locale
     */
    transform(locale, stage) {
        let errorPrefix = '/models/'+locale+'.json - ';

        let Helper = require('./lmHelper');
        let locales = [];
        if (locale.length === 2) {
            try {

                if (!Helper.Project.getConfig(stage, `alexaSkill.nlu.lang.${locale}`)) {
                    throw new Error();
                }
                locales = Helper.Project.getConfig(stage, `alexaSkill.nlu.lang.${locale}`);
            } catch (error) {
                throw new Error('Could not retrieve locales mapping for language ' + locale);
            }
        } else {
            locales = [locale];
        }
        let model;
        try {
            model = Helper.Project.getModel(locale);
        } catch (e) {
            return;
        }
        let alexaModel = {};

        _.set(alexaModel, 'interactionModel.languageModel.invocationName', model.invocation);
        if (alexaModel.interactionModel.languageModel.invocationName.length === 0) {
            throw new Error(errorPrefix + 'Invocation cannot be empty');
        }

        alexaModel.interactionModel.languageModel.types = [];

        let alexaIntents = [];
        // convert generic intents
        for (let intent of model.intents) {
            let alexaIntentObj = {
                name: intent.name,
                samples: intent.phrases,
            };
            if (alexaIntentObj.samples.length === 0) {
                throw new Error(
                    errorPrefix + `Intent "${alexaIntentObj.name}" must have at least one sample phrase` // eslint-disable-line
                );
            }
            for (let sample of alexaIntentObj.samples) {
                if (/\d/.test(sample)) { // has number?
                    throw new Error(errorPrefix + `Intent "${alexaIntentObj.name}" must not have numbers in sample`); // eslint-disable-line
                }
            }

            // handle intent inputs
            if (intent.inputs) {
                alexaIntentObj.slots = [];

                for (let input of intent.inputs) {
                    let alexaInputObj = {
                        name: input.name,
                    };

                    if (typeof input.type === 'object') {
                        if (input.type.alexa) {
                            alexaInputObj.type = input.type.alexa;
                            if (_.startsWith(input.type.alexa, BUILTIN_PREFIX)) {
                                alexaInputObj.type = input.type.alexa;
                            } else {
                                input.type = input.type.alexa;
                            }
                        } else {
                            throw new Error(errorPrefix + 'Please add an Alexa property for input "'+input.name+'"');
                        }
                    }

                    // handle custom input types
                    if (!alexaInputObj.type) {
                        if (!input.type) {
                            throw new Error(errorPrefix + 'Invalid input type in intent "' + intent.name + '"');
                        }

                        alexaInputObj.type = input.type;

                        // throw error when no inputTypes object defined
                        if (!model.inputTypes) {
                            throw new Error(errorPrefix + 'Input type "' + alexaInputObj.type + '" must be defined in inputTypes');
                        }

                        // find type in global inputTypes array
                        let matchedInputTypes = model.inputTypes.filter((item) => {
                            return item.name === alexaInputObj.type;
                        });

                        if (matchedInputTypes.length === 0) {
                            throw new Error(errorPrefix + 'Input type "' + alexaInputObj.type + '" must be defined in inputTypes');
                        }

                        if (!alexaModel.interactionModel.languageModel.types) {
                            alexaModel.interactionModel.languageModel.types = [];
                        }

                        // create alexaTypeObj from matched input types
                        for (let matchedInputType of matchedInputTypes) {
                            let alexaTypeObj = {
                                name: matchedInputType.name,
                                values: [],
                            };

                            if (!matchedInputType.values) {
                                throw new Error(
                                    errorPrefix + `Input type "${matchedInputType.name}" must have at leas one value` // eslint-disable-line
                                );
                            }

                            // create alexaTypeValueObj
                            for (let value of matchedInputType.values) {
                                let alexaTypeValueObj = {
                                    id: value.id ? value.id : null,
                                    name: {
                                        value: value.value,
                                    },
                                };
                                // save synonyms, if defined
                                if (value.synonyms) {
                                    alexaTypeValueObj.name.synonyms = value.synonyms;
                                }
                                alexaTypeObj.values.push(alexaTypeValueObj);
                            }

                            // skip existing alexa types
                            let existingAlexaTypes = alexaModel.interactionModel.languageModel.types.filter((item) => { // eslint-disable-line
                                return alexaTypeObj.name === item.name;
                            });

                            if (existingAlexaTypes.length === 0) {
                                // add type to interaction model
                                alexaModel.interactionModel.languageModel.types.push(alexaTypeObj);
                            }
                        }
                    }
                    if (_.get(input, 'alexa')) {
                        _.merge(alexaInputObj, input.alexa);
                    }
                    alexaIntentObj.slots.push(alexaInputObj);
                }
            }

            if (_.get(intent, 'alexa')) {
                _.merge(alexaIntentObj, intent.alexa);
            }

            alexaIntents.push(alexaIntentObj);
        }

        // convert alexa specific intents
        if (_.get(model, 'alexa.interactionModel.languageModel.intents')) {
            for (let intent of _.get(model, 'alexa.interactionModel.languageModel.intents')) {
                alexaIntents.push(intent);
            }
        }
        _.set(alexaModel, 'interactionModel.languageModel.intents', alexaIntents);

        // prompts
        if (_.get(model, 'alexa.interactionModel.prompts')) {
            _.set(alexaModel, 'interactionModel.prompts', _.get(model, 'alexa.interactionModel.prompts'));
        }

        // types
        if (_.get(model, 'alexa.interactionModel.languageModel.types')) {
            _.set(alexaModel, 'interactionModel.languageModel.types', _.get(model, 'alexa.interactionModel.languageModel.types'));
        }

        // dialog
        if (_.get(model, 'alexa.interactionModel.dialog')) {
            _.set(alexaModel, 'interactionModel.dialog', _.get(model, 'alexa.interactionModel.dialog'));
        }

        // types
        if (_.get(model, 'inputTypes')) {
            for (let inputType of model.inputTypes) {
                let findings = [];

                // skip input types that are already in alexa types
                if (_.get(alexaModel, 'interactionModel.languageModel.types')) {
                    findings = alexaModel.interactionModel.languageModel.types.filter((item) => {
                        return inputType.name === item.name;
                    });
                }

                if (findings.length > 0) {
                    continue;
                }

                // create alexa type
                let alexaType = {
                    name: inputType.name,
                    values: [],
                };

                // iterate through values
                for (let value of inputType.values) {
                    let alexaTypeValue = {
                        id: value.id,
                        name: {
                            value: value.value,
                        },
                    };

                    if (value.synonyms) {
                        alexaTypeValue.name.synonyms = value.synonyms;
                    }

                    alexaType.values.push(alexaTypeValue);
                }

                alexaModel.interactionModel.languageModel.types.push(alexaType);
            }
        }
        for (let targetLocale of locales) {
            fs.writeFileSync(
                require('./alexaUtil').getModelPath(targetLocale),
                JSON.stringify(alexaModel, null, '\t')
                );
        }
    }

    /**
     * Save Alexa model to file
     * @param {string} locale
     * @return {Promise<any>}
     */
    save(locale) {
        return new Promise((resolve, reject) => {
            fs.writeFile(require('./alexaUtil').getModelPath(locale), JSON.stringify(this, null, '\t'), function(err, data) {
                if (err) {
                    return reject(err);
                }
                resolve();
            });
        });
    }
}

// let alexaModel = require('./demoproject/platforms/alexaSkill/models/en-US.json');
//
// let aim = new AlexaInteractionModel(alexaModel);
//
// let model = require('./demoproject/models/en-US.json');
// // aim.validateSlots(model);
// aim.transform(model);
//
// aim.save('en-US', function() {
//     console.log('done');
// });

//
// let jovoModel = new JovoModel();
// jovoModel.fromAlexa(require('./../demo/platforms/alexaSkill/models/de-DE'))
//
// console.log(JSON.stringify(jovoModel, null, '\t'));
//
module.exports.AlexaInteractionModel = AlexaInteractionModel;
