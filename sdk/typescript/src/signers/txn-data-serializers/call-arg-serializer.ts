// Copyright (c) Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Provider } from '../../providers/provider';
import {
  extractMutableReference,
  extractStructTag,
  getObjectReference,
  getSharedObjectInitialVersion,
  isSharedObject,
  isValidSuiAddress,
  normalizeSuiObjectId,
  ObjectId,
  SuiJsonValue,
  SuiMoveNormalizedType,
} from '../../types';
import { bcs, CallArg, MoveCallTx, ObjectArg } from '../../types/sui-bcs';
import { shouldUseOldSharedObjectAPI } from './local-txn-data-serializer';
import { MoveCallTransaction } from './txn-data-serializer';

const MOVE_CALL_SER_ERROR = 'Move call argument serialization error:';

const isTypeFunc = (type: string) => (t: any) => typeof t === type;

export class CallArgSerializer {
  constructor(private provider: Provider) {}

  async extractObjectIds(txn: MoveCallTransaction): Promise<ObjectId[]> {
    const args = await this.serializeMoveCallArguments(txn);
    return args
      .map((arg) =>
        'ObjVec' in arg
          ? Array.from(arg.ObjVec).map((a) => ({
              Object: a,
            }))
          : arg
      )
      .flat()
      .map((arg) => {
        if ('Object' in arg) {
          const objectArg = arg.Object;
          if ('Shared_Deprecated' in objectArg) {
            return objectArg.Shared_Deprecated;
          } else if ('Shared' in objectArg) {
            return objectArg.Shared.objectId;
          } else {
            return objectArg.ImmOrOwned.objectId;
          }
        }
        return null;
      })
      .filter((a) => a != null) as ObjectId[];
  }

  async serializeMoveCallArguments(
    txn: MoveCallTransaction
  ): Promise<CallArg[]> {
    const userParams = await this.extractNormalizedFunctionParams(
      txn.packageObjectId,
      txn.module,
      txn.function
    );

    if (userParams.length !== txn.arguments.length) {
      throw new Error(
        `${MOVE_CALL_SER_ERROR} expect ${userParams.length} ` +
          `arguments, received ${txn.arguments.length} arguments`
      );
    }
    return Promise.all(
      userParams.map(async (param, i) =>
        this.newCallArg(param, txn.arguments[i])
      )
    );
  }

  /**
   * Deserialize Call Args used in `Transaction` into `SuiJsonValue` arguments
   */
  async deserializeCallArgs(txn: MoveCallTx): Promise<SuiJsonValue[]> {
    const userParams = await this.extractNormalizedFunctionParams(
      txn.Call.package.objectId,
      txn.Call.module,
      txn.Call.function
    );

    return Promise.all(
      userParams.map(async (param, i) =>
        this.deserializeCallArg(param, txn.Call.arguments[i])
      )
    );
  }

  private async extractNormalizedFunctionParams(
    packageId: ObjectId,
    module: string,
    functionName: string
  ) {
    const normalized = await this.provider.getNormalizedMoveFunction(
      normalizeSuiObjectId(packageId),
      module,
      functionName
    );
    const params = normalized.parameters;
    // Entry functions can have a mutable reference to an instance of the TxContext
    // struct defined in the TxContext module as the last parameter. The caller of
    // the function does not need to pass it in as an argument.
    const hasTxContext = params.length > 0 && this.isTxContext(params.at(-1)!);
    return hasTxContext ? params.slice(0, params.length - 1) : params;
  }

  async newObjectArg(objectId: string): Promise<ObjectArg> {
    const object = await this.provider.getObject(objectId);
    const version = await this.provider.getRpcApiVersion();

    if (shouldUseOldSharedObjectAPI(version)) {
      if (isSharedObject(object)) {
        return { Shared_Deprecated: objectId };
      }
    } else {
      const initialSharedVersion = getSharedObjectInitialVersion(object);
      if (initialSharedVersion) {
        return { Shared: { objectId, initialSharedVersion } };
      }
    }

    return { ImmOrOwned: getObjectReference(object)! };
  }

  private async newCallArg(
    expectedType: SuiMoveNormalizedType,
    argVal: SuiJsonValue
  ): Promise<CallArg> {
    const structVal = extractStructTag(expectedType);
    if (structVal != null) {
      if (typeof argVal !== 'string') {
        throw new Error(
          `${MOVE_CALL_SER_ERROR} expect the argument to be an object id string, got ${JSON.stringify(
            argVal,
            null,
            2
          )}`
        );
      }
      return { Object: await this.newObjectArg(argVal) };
    }

    if (
      typeof expectedType === 'object' &&
      'Vector' in expectedType &&
      typeof expectedType.Vector === 'object' &&
      'Struct' in expectedType.Vector
    ) {
      if (!Array.isArray(argVal)) {
        throw new Error(
          `Expect ${argVal} to be a array, received ${typeof argVal}`
        );
      }
      return {
        ObjVec: await Promise.all(
          argVal.map((arg) => this.newObjectArg(arg as string))
        ),
      };
    }

    let serType = this.getPureSerializationType(expectedType, argVal);
    return {
      Pure: bcs.ser(serType, argVal).toBytes(),
    };
  }

  private extractIdFromObjectArg(arg: ObjectArg) {
    if ('ImmOrOwned' in arg) {
      return arg.ImmOrOwned.objectId;
    } else if ('Shared' in arg) {
      return arg.Shared.objectId;
    }
    // TODO: remove after DevNet 0.13.0
    return arg.Shared_Deprecated;
  }

  private async deserializeCallArg(
    expectedType: SuiMoveNormalizedType,
    argVal: CallArg
  ): Promise<SuiJsonValue> {
    if ('Object' in argVal) {
      return this.extractIdFromObjectArg(argVal.Object);
    } else if ('ObjVec' in argVal) {
      return Array.from(argVal.ObjVec).map((o) =>
        this.extractIdFromObjectArg(o)
      );
    }

    const serType = this.getPureSerializationType(expectedType, undefined);
    return bcs.de(serType, Uint8Array.from(argVal.Pure));
  }

  /**
   *
   * @param argVal used to do additional data validation to make sure the argVal
   * matches the normalized Move types. If `argVal === undefined`, the data validation
   * will be skipped. This is useful in the case where `normalizedType` is a vector<T>
   * and `argVal` is an empty array, the data validation for the inner types will be skipped.
   */
  private getPureSerializationType(
    normalizedType: SuiMoveNormalizedType,
    argVal: SuiJsonValue | undefined
  ): string {
    const allowedTypes = [
      'Address',
      'Bool',
      'U8',
      'U16',
      'U32',
      'U64',
      'U128',
      'U256',
    ];
    if (
      typeof normalizedType === 'string' &&
      allowedTypes.includes(normalizedType)
    ) {
      if (normalizedType in ['U8', 'U16', 'U32', 'U64', 'U128', 'U256']) {
        this.checkArgVal(isTypeFunc('number'), argVal, 'number');
      } else if (normalizedType === 'Bool') {
        this.checkArgVal(isTypeFunc('boolean'), argVal, 'boolean');
      } else if (normalizedType === 'Address') {
        this.checkArgVal(
          (t: any) => typeof t === 'string' && isValidSuiAddress(t),
          argVal,
          'valid SUI address'
        );
      }
      return normalizedType.toLowerCase();
    } else if (typeof normalizedType === 'string') {
      throw new Error(
        `${MOVE_CALL_SER_ERROR} unknown pure normalized type ${JSON.stringify(
          normalizedType,
          null,
          2
        )}`
      );
    }

    if ('Vector' in normalizedType) {
      if (
        (argVal === undefined || typeof argVal === 'string') &&
        normalizedType.Vector === 'U8'
      ) {
        return 'string';
      }

      if (argVal !== undefined && !Array.isArray(argVal)) {
        throw new Error(
          `Expect ${argVal} to be a array, received ${typeof argVal}`
        );
      }
      const innerType = this.getPureSerializationType(
        normalizedType.Vector,
        // undefined when argVal is empty
        argVal ? argVal[0] : undefined
      );
      const res = `vector<${innerType}>`;
      // TODO: can we get rid of this call and make it happen automatically?
      bcs.registerVectorType(res, innerType);
      return res;
    }

    throw new Error(
      `${MOVE_CALL_SER_ERROR} unknown normalized type ${JSON.stringify(
        normalizedType,
        null,
        2
      )}`
    );
  }

  private checkArgVal(
    check: (t: any) => boolean,
    argVal: SuiJsonValue | undefined,
    expectedType: string
  ) {
    if (argVal === undefined) {
      return;
    }
    if (!check(argVal)) {
      throw new Error(
        `Expect ${argVal} to be ${expectedType}, received ${typeof argVal}`
      );
    }
  }

  private isTxContext(param: SuiMoveNormalizedType): boolean {
    const struct = extractStructTag(param)?.Struct;
    return (
      extractMutableReference(param) != null &&
      struct?.address === '0x2' &&
      struct?.module === 'tx_context' &&
      struct?.name === 'TxContext'
    );
  }
}
