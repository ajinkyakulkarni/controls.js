/*!
 * Controls.js
 * http://controlsjs.com/
 *
 * Copyright (c) 2014 Position s.r.o.  All rights reserved.
 *
 * This version of Controls.js is licensed under the terms of GNU General Public License v3.
 * http://www.gnu.org/licenses/gpl-3.0.html
 *
 * The commercial license can be purchased at Controls.js website.
 */

if(typeof ngBindingsHandlers === 'undefined') ngBindingsHandlers = new Array();

var ngvmf_hintevents_initialized = false;

function ngRegisterBindingHandler(type,update,init,after)
{
  var handler=ngBindingsHandlers[type];

  if(typeof handler==='undefined') {
    handler = {
      Init: null,
      Update: null,
      AddEvent: ngObjAddEvent,
      RemoveEvent: ngObjRemoveEvent
    }
    ngBindingsHandlers[type] = handler;
  }

  if(typeof init==='function')   handler.AddEvent('Init',init,true);
  if(typeof update==='function') handler.AddEvent('Update',update,true);
  if(typeof after!=='undefined') handler.After=after;
}

function ng_Bindings(bindings)
{
  if(arguments.length<=1)
  {
    if(ng_typeString(bindings)) return bindings;
    if(!ng_typeObject(bindings)) return '';
    var ret='',v;
    for(var i in bindings)
    {
      if(ret!='') ret+=',';
      ret+=i+':';
      v=bindings[i];
      if(ng_typeObject(v)) ret+='{'+ng_Bindings(v)+'}';
      else ret+=ng_toString(v);
    }
    return ret;
  }
  else
  {
    var ret=new Object;
    var mid='self',arg;
    for(var i=0;i<arguments.length;i++)
    {
      arg=arguments[i];
      if(ng_typeObject(arg))
      {
        if(mid=='') break;
        ret[mid]=ng_Bindings(arg);
        mid='';
      }
      else
      {
        if(ng_typeString(arg))
        {
          if((mid=='')||(mid=='self')) mid=arg;
          else {
            ret[mid]=arg;
            mid='';
          }
        }
        else mid='';
      }
    }
    return ret;
  }
}

function ngApplyBindings(ctrl, viewModel, databind)
{
  if(ng_typeString(viewModel))
  {
    var vm=getViewModelById(viewModel);
    if(!vm) ngDEBUGERROR('ViewModel "'+viewModel+'" referenced from control "'+ctrl.ID+'" not found!');
    viewModel=vm;
  }
  if(!viewModel) ngDEBUGERROR('ViewModel for control "'+ctrl.ID+'" not found!');

  if((!ctrl)||(!viewModel)||(ngVal(databind,'')=='')) return false;

  if(viewModel.ViewModel) viewModel=viewModel.ViewModel;

  var bindingContext = (viewModel && (viewModel instanceof ko.bindingContext)
                        ? viewModel
                        : new ko.bindingContext(viewModel));
    
  function add_ctrl_binding(c,type,valueAccessor,allBindingsAccessor,viewModel)
  {
    if(typeof c.DataBindings!=='object') c.DataBindings={};
    var binding = {
      ViewModel: viewModel,
      ValueAccessor: valueAccessor,
      BindingsAccessor: allBindingsAccessor
    };
    c.DataBindings[type]=binding;
  }

  // Returns the value of a valueAccessor function
  function evaluateValueAccessor(valueAccessor) {
      return valueAccessor();
  }

  // Given a function that returns bindings, create and return a new object that contains
  // binding value-accessors functions. Each accessor function calls the original function
  // so that it always gets the latest value and all dependencies are captured. This is used
  // by ko.applyBindingsToNode and getBindingsAndMakeAccessors.
  function makeAccessorsFromFunction(callback) {
      return ko.utils.objectMap(ko.dependencyDetection.ignore(callback), function(value, key) {
          return function() {
            var v=callback()[key];
            return (ngIsFieldDef(v) ? v.Value : v); // if ngFieldDef, use Value
          };
      });
  }

  // This function is used if the binding provider doesn't include a getBindingAccessors function.
  // It must be called with 'this' set to the provider instance.
  function getBindingsAndMakeAccessors(node, context) {
//        return makeAccessorsFromFunction(this['getBindings'].bind(this, node, context));
      return makeAccessorsFromFunction(this['parseBindingsString'].bind(this, databind, context, ctrl, {'valueAccessors':false}));
  }
  
  function topologicalSortBindings(bindings) {
    // Depth-first sort
    var result = [],                // The list of key/handler pairs that we will return
        bindingsConsidered = {},    // A temporary record of which bindings are already in 'result'
        cyclicDependencyStack = []; // Keeps track of a depth-search so that, if there's a cycle, we know which bindings caused it
    ko.utils.objectForEach(bindings, function pushBinding(bindingKey) {
        if (!bindingsConsidered[bindingKey]) {
            if(bindingKey.substring(0,3)=='_ko') return;
            var binding = ko['getBindingHandler'](bindingKey);
            if (binding) {
                // First add dependencies (if any) of the current binding
                if (binding['After']) {
                    cyclicDependencyStack.push(bindingKey);
                    ko.utils.arrayForEach(binding['After'], function(bindingDependencyKey) {
                        if (bindings[bindingDependencyKey]) {
                            if (ko.utils.arrayIndexOf(cyclicDependencyStack, bindingDependencyKey) !== -1) {
                                var errmsg="Cannot combine the following bindings, because they have a cyclic dependency: " + cyclicDependencyStack.join(", ");
                                ngDEBUGERROR(errmsg);
                                throw Error(errmsg);
                            } else {
                                pushBinding(bindingDependencyKey);
                            }
                        }
                    });
                    cyclicDependencyStack.pop();
                }
                // Next add the current binding
                result.push({ key: bindingKey, handler: binding });
            }
            bindingsConsidered[bindingKey] = true;
        }
    });

    return result;
  }
  

  var oldhandler = ko['getBindingHandler'];
  try
  {  
    ko['getBindingHandler'] = function(bindingKey) {
        return (ngBindingsHandlers ? ngBindingsHandlers[bindingKey] : null);
    };
  
    // Use bindings if given, otherwise fall back on asking the bindings provider to give us some bindings
    var bindings;
  /*  if (sourceBindings && typeof sourceBindings !== 'function') {
        bindings = sourceBindings;
    } else {*/
        var provider = ko.bindingProvider['instance'],
            getBindings = /*provider['getBindingAccessors'] ||*/ getBindingsAndMakeAccessors;
        if (/*sourceBindings || */(bindingContext._subscribable) || (ko.version!=='3.0.0')) { // in ko 3.4.0 this condition doesn't exists
            // When an obsevable view model is used, the binding context will expose an observable _subscribable value.
            // Get the binding from the provider within a computed observable so that we can update the bindings whenever
            // the binding context is updated.
            var bindingsUpdater = ko.dependentObservable(
                function() {
                    bindings = /*sourceBindings ? sourceBindings(bindingContext, ctrl) :*/ getBindings.call(provider, ctrl, bindingContext);
                    // Register a dependency on the binding context
                    if (bindings && bindingContext._subscribable)
                        bindingContext._subscribable();
                    return bindings;
                },
                null, { disposeWhenNodeIsRemoved: false/*node*/ }
            );
                              
            if (!bindings || !bindingsUpdater.isActive())
                bindingsUpdater = null;

            if(bindingsUpdater) {
              ctrl.AddEvent('DoDispose',function() {
                if(bindingsUpdater) bindingsUpdater.dispose();
                return true;
              });
            }

        } else {
            bindings = ko.dependencyDetection.ignore(getBindings, provider, [ctrl, bindingContext]);
        }
  //  }
  
  //  var bindingHandlerThatControlsDescendantBindings;
    if (bindings) {
        // Return the value accessor for a given binding. When bindings are static (won't be updated because of a binding
        // context update), just return the value accessor from the binding. Otherwise, return a function that always gets
        // the latest binding value and registers a dependency on the binding updater.
        var getValueAccessor = bindingsUpdater
            ? function(bindingKey) {
                return function() {
                    return evaluateValueAccessor(bindingsUpdater()[bindingKey]);
                };
            } : function(bindingKey) {
                return bindings[bindingKey];
            };
  
        // Use of allBindings as a function is maintained for backwards compatibility, but its use is deprecated
        function allBindings() {
            return ko.utils.objectMap(bindingsUpdater ? bindingsUpdater() : bindings, evaluateValueAccessor);
        }
        // The following is the 3.x allBindings API
        allBindings['get'] = function(key) {
            return bindings[key] && evaluateValueAccessor(getValueAccessor(key));
        };
        allBindings['has'] = function(key) {
            return key in bindings;
        };
  
        // First put the bindings into the right order
        var orderedBindings = topologicalSortBindings(bindings);
  
        // Go through the sorted bindings, calling init and update for each
        ko.utils.arrayForEach(orderedBindings, function(bindingKeyAndHandler) {
            // Note that topologicalSortBindings has already filtered out any nonexistent binding handlers,
            // so bindingKeyAndHandler.handler will always be nonnull.
            var handlerInitFn = bindingKeyAndHandler.handler["Init"],
                handlerUpdateFn = bindingKeyAndHandler.handler["Update"],
                bindingKey = bindingKeyAndHandler.key;
  
            add_ctrl_binding(ctrl, bindingKey, getValueAccessor(bindingKey), allBindings, bindingContext['$data']);
  
  //          if (node.nodeType === 8) {
  //              validateThatBindingIsAllowedForVirtualElements(bindingKey);
  //          }
  
            try {
                // Run init, ignoring any dependencies
                if ((typeof handlerInitFn === "function")||(ctrl.OnDataBindingInit)) {
                    ko.dependencyDetection.ignore(function() {
                      if((ctrl.OnDataBindingInit)&&(!ngVal(ctrl.OnDataBindingInit(ctrl,bindingKey,getValueAccessor(bindingKey), allBindings, bindingContext['$data']),false))) return;
                      if(typeof handlerInitFn === "function") {
                        var initResult = handlerInitFn(ctrl, getValueAccessor(bindingKey), allBindings, bindingContext['$data'], bindingContext);
    
    /*                      // If this binding handler claims to control descendant bindings, make a note of this
                          if (initResult && initResult['controlsDescendantBindings']) {
                              if (bindingHandlerThatControlsDescendantBindings !== undefined)
                                  throw new Error("Multiple bindings (" + bindingHandlerThatControlsDescendantBindings + " and " + bindingKey + ") are trying to control descendant bindings of the same element. You cannot use these bindings together on the same element.");
                              bindingHandlerThatControlsDescendantBindings = bindingKey;
                          }*/
                      }
                    });
                }
  
                // Run update in its own computed wrapper
                if ((typeof handlerUpdateFn === "function")||(ctrl.OnDataBindingUpdate)) {
                    var dependentObservable = ko.dependentObservable(
                        function() {
                            if((ctrl.OnDataBindingUpdate)&&(!ngVal(ctrl.OnDataBindingUpdate(ctrl,bindingKey,getValueAccessor(bindingKey), allBindings, bindingContext['$data']),false))) return;
                            if (typeof handlerUpdateFn === "function") handlerUpdateFn(ctrl, getValueAccessor(bindingKey), allBindings, bindingContext['$data'], bindingContext);
                        },
                        null,
                        { disposeWhenNodeIsRemoved: false/*node*/ }
                    );
                                                        
                    ctrl.AddEvent('DoDispose',function() {
                      dependentObservable.dispose();
                      return true;
                    });
                }
            } catch (ex) {
                ex.message = "Unable to process binding \"" + bindingKey + ": " + bindings[bindingKey] + "\"\nMessage: " + ex.message;
                ngDEBUGERROR(ex.message)
                throw ex;
            }
        });
    }
  }
  finally
  {
    ko['getBindingHandler']=oldhandler;
  }
  
  return true;
}

// Simple calculation based on Levenshtein distance.
function ngca_calcEditDistMatrix(oldArray, newArray, cmpfnc, maxAllowedDistance) {
    var distances = [];
    for (var i = 0; i <= newArray.length; i++)
        distances[i] = [];

    // Top row - transform old array into empty array via deletions
    for (var i = 0, j = Math.min(oldArray.length, maxAllowedDistance); i <= j; i++)
        distances[0][i] = i;

    // Left row - transform empty array into new array via additions
    for (var i = 1, j = Math.min(newArray.length, maxAllowedDistance); i <= j; i++) {
        distances[i][0] = i;
    }

    // Fill out the body of the array
    var oldIndex, oldIndexMax = oldArray.length, newIndex, newIndexMax = newArray.length;
    var distanceViaAddition, distanceViaDeletion;
    for (oldIndex = 1; oldIndex <= oldIndexMax; oldIndex++) {
        var newIndexMinForRow = Math.max(1, oldIndex - maxAllowedDistance);
        var newIndexMaxForRow = Math.min(newIndexMax, oldIndex + maxAllowedDistance);
        for (newIndex = newIndexMinForRow; newIndex <= newIndexMaxForRow; newIndex++) {
            if (cmpfnc(oldArray[oldIndex - 1],newArray[newIndex - 1]))
                distances[newIndex][oldIndex] = distances[newIndex - 1][oldIndex - 1];
            else {
                var northDistance = distances[newIndex - 1][oldIndex] === undefined ? Number.MAX_VALUE : distances[newIndex - 1][oldIndex] + 1;
                var westDistance = distances[newIndex][oldIndex - 1] === undefined ? Number.MAX_VALUE : distances[newIndex][oldIndex - 1] + 1;
                distances[newIndex][oldIndex] = Math.min(northDistance, westDistance);
            }
        }
    }

    return distances;
}

function ngca_findEditScriptFromEditDistMatrix(editDistanceMatrix, oldArray, newArray) {
    var oldIndex = oldArray.length;
    var newIndex = newArray.length;
    var editScript = [];
    var maxDistance = editDistanceMatrix[newIndex][oldIndex];
    if (maxDistance === undefined)
        return null; // maxAllowedDistance must be too small
    while ((oldIndex > 0) || (newIndex > 0)) {
        var me = editDistanceMatrix[newIndex][oldIndex];
        var distanceViaAdd = (newIndex > 0) ? editDistanceMatrix[newIndex - 1][oldIndex] : maxDistance + 1;
        var distanceViaDelete = (oldIndex > 0) ? editDistanceMatrix[newIndex][oldIndex - 1] : maxDistance + 1;
        var distanceViaRetain = (newIndex > 0) && (oldIndex > 0) ? editDistanceMatrix[newIndex - 1][oldIndex - 1] : maxDistance + 1;
        if ((distanceViaAdd === undefined) || (distanceViaAdd < me - 1)) distanceViaAdd = maxDistance + 1;
        if ((distanceViaDelete === undefined) || (distanceViaDelete < me - 1)) distanceViaDelete = maxDistance + 1;
        if (distanceViaRetain < me - 1) distanceViaRetain = maxDistance + 1;

        if ((distanceViaAdd <= distanceViaDelete) && (distanceViaAdd < distanceViaRetain)) {
            editScript.push({ status: 1/*"added"*/, value: newArray[newIndex - 1] });
            newIndex--;
        } else if ((distanceViaDelete < distanceViaAdd) && (distanceViaDelete < distanceViaRetain)) {
            editScript.push({ status: 2/*"deleted"*/, value: oldArray[oldIndex - 1] });
            oldIndex--;
        } else {
            editScript.push({ status: 0/*"retained"*/, value: oldArray[oldIndex - 1] });
            newIndex--;
            oldIndex--;
        }
    }
    return editScript.reverse();
}

function ng_GetArraysEditScript(oldArray, newArray, cmpfnc, maxEditsToConsider) {
    if (maxEditsToConsider === undefined) {
        return ng_GetArraysEditScript(oldArray, newArray, cmpfnc, 1)                 // First consider likely case where there is at most one edit (very fast)
            || ng_GetArraysEditScript(oldArray, newArray, cmpfnc, 10)                // If that fails, account for a fair number of changes while still being fast
            || ng_GetArraysEditScript(oldArray, newArray, cmpfnc, Number.MAX_VALUE); // Ultimately give the right answer, even though it may take a long time
    } else {
        oldArray = oldArray || [];
        newArray = newArray || [];
        var editDistanceMatrix = ngca_calcEditDistMatrix(oldArray, newArray, cmpfnc, maxEditsToConsider);
        return ngca_findEditScriptFromEditDistMatrix(editDistanceMatrix, oldArray, newArray);
    }
};


function ngsvm_DoCreate(def, ref)
{
  if(this.ID!='') {
    ngViewModels[this.ID] = this;
  }
}

/*  Class: ngSysViewModel
 *  This class implements non-visual <ngSysViewModel> control (based on <ngViewModel>).
 */
function ngSysViewModel(id, namespace)
{
  ngSysControl(this, id, 'ngSysViewModel');
  this.DoCreate=ngsvm_DoCreate;

  this.__viewModel = ngViewModel;
  try {
    this.__viewModel(id);
  } finally {
    delete this.__viewModel;
  }
  ngControlCreated(this);
}

function ngvmf_DoDispose()
{
  this.SetViewModel(null);
  return true;
}

function ngvmf_OnCommand(vm,cmd,options)
{
  var form=vm.ViewModelForm;
  if(form)
  {
    if((form.OnCommand)&&(!ngVal(form.OnCommand(form,cmd,options),false))) return false;
    form.ResetErrors();
  }
  return true;
}

function ngvmf_ShowControl(c,s)
{
  if(!c) return;
  var o=c['binding_updatingVisible'];
  try
  {
    c['binding_updatingVisible']=true;
    c.SetVisible(s);
  }
  finally
  {
    if(ng_isEmpty(o)) delete c['binding_updatingVisible'];
    else c['binding_updatingVisible']=o;
  }
}

function ngvmf_EnableControl(c,s)
{
  if(!c) return;
  var o=c['binding_updatingEnabled'];
  try
  {
    c['binding_updatingEnabled']=true;
    c.SetEnabled(s);
  }
  finally
  {
    if(ng_isEmpty(o)) delete c['binding_updatingEnabled'];
    else c['binding_updatingEnabled']=o;
  }
}

function ngvmf_SetChildControlsEnabled(v,p)
{
  if(v) this.EnableControls();
  else  this.DisableControls();
} 

function ngvmf_DisableControls()
{
  if(this.disablectrlscnt<=0)
  {
    this.disablectrlscnt=0;
    this._changingdisabledcontrols=true;
    try
    {
      var self=this;
      function setenabled(v,p)
      {
        if(!self._changingdisabledcontrols)
          this._vmEnabled=ngVal(v,true);
      }
      
      function disablecontrols(f)
      {
        if(!ng_typeObject(f.ChildControls)) return;
        var c,enabled,undefined;
        for(var i=0;i<f.ChildControls.length;i++)
        {
          c=f.ChildControls[i];
          if(!c) continue;
          if(typeof c.DisableControls !== 'function') disablecontrols(c);
          if((typeof c.SetEnabled === 'function')&&(typeof c._vmEnabled === 'undefined'))
          {
            c._vmEnabled=ngVal(c.Enabled,true);
            self.EnableControl(c,false);
            c._vmSetEnabled = c.SetEnabled;
            c.SetEnabled=setenabled;
          }
        }
      }
      disablecontrols(this);
    }
    finally
    {
      delete this._changingdisabledcontrols;
    }
  }
  this.disablectrlscnt++;
}

function ngvmf_EnableControls()
{
  if(this.disablectrlscnt<=0) return;
  this.disablectrlscnt--;
  if(!this.disablectrlscnt)
  {  
    this._changingdisabledcontrols=true;
    try
    {
      var self=this;
      function enablecontrols(f)
      {
        if(!ng_typeObject(f.ChildControls)) return;
        var c;
        for(var i=0;i<f.ChildControls.length;i++)
        {
          c=f.ChildControls[i];
          if(!c) continue;
          if(typeof c._vmEnabled!=='undefined')
          {
            c.SetEnabled=c._vmSetEnabled;
            delete c._vmSetEnabled;
            self.EnableControl(c,c._vmEnabled);
            delete c._vmEnabled;
          }
          if(typeof c.EnableControls !== 'function') enablecontrols(c);
          
        }
      }
      enablecontrols(this);
    }
    finally
    {
      delete this._changingdisabledcontrols;
    }
  }
}

function ngvmf_OnCommandRequest(vm,rpc)
{
  var form=vm.ViewModelForm;
  if(form)
  {
    if((form.OnCommandRequest)&&(!ngVal(form.OnCommandRequest(form,rpc),false))) return false;

    form.ShowLoading(true);

    if(form.DisableOnCommand) {
      if(form.disable_ctrls_timer) clearTimeout(form.disable_ctrls_timer);
      form.disable_ctrls_timer=setTimeout(function() {
        if(form.disable_ctrls_timer) clearTimeout(form.disable_ctrls_timer);
        delete form.disable_ctrls_timer;
        
        if(form.DisableOnCommand) form.DisableControls();
      },1);
    }
  }
  return true;
}

function ngvmf_OnCommandCancel(vm)
{
  var form=vm.ViewModelForm;
  if(form)
  {
    if(form.OnCommandResults) form.OnCommandCancel(form);
    if(form.disable_ctrls_timer) {
      clearTimeout(form.disable_ctrls_timer);
      delete form.disable_ctrls_timer;
    }
    else if(form.DisableOnCommand) form.EnableControls();
  }
}

function ngvmf_OnCommandResults(vm,cmd,sresults)
{
  var form=vm.ViewModelForm;
  if(form)
  {
    if(form.OnCommandResults) form.OnCommandResults(form,cmd,sresults);
    if(form.disable_ctrls_timer) {
      clearTimeout(form.disable_ctrls_timer);
      delete form.disable_ctrls_timer;
    }
    else if(form.DisableOnCommand) form.EnableControls();
  }
  return true;
}
function ngvmf_OnCommandFinished(vm,cmd,sresults)
{
  var form=vm.ViewModelForm;
  if(form)
  {
    form.ShowLoading(false);
    if(form.OnCommandFinished) form.OnCommandFinished(form,cmd,sresults);
  }
  return true;
}

function ngvmf_OnShowErrors(vm,errmsg,errors)
{
  var form=vm.ViewModelForm;
  if(form) form.ShowErrors(errors);
  return false;
}

function ngvmf_FindFieldControl(fid, visibleonly, bindings, parentfielddef)
{
  var found=this.FindFieldControls(fid, visibleonly, bindings, parentfielddef);
  if(found.length>0) return found[0];
  return null;
}

function ngvmf_FindFieldControls(fid, visibleonly, bindings, parentfielddef)
{
  visibleonly=ngVal(visibleonly,true);
  bindings=ngVal(bindings,this.DefaultFindFieldControlsBindings);
  parentfielddef=ngVal(parentfielddef,null);
  if(this.OnFindFieldControls)
  {
    var ctrls=this.OnFindFieldControls(this,fid, visibleonly, bindings, parentfielddef);
    if(ng_IsArrayVar(ctrls)) return ctrls;
  }  
  var found=[];
  if(bindings)
  {
    var b=new Array();
    for(var j=0;j<bindings.length;j++)
      b[bindings[j]]=true;
    bindings=b;
  }
  function findfield(f)
  {
    if(!ng_typeObject(f.ChildControls)) return;
    var c,b,v;
    for(var i=0;i<f.ChildControls.length;i++)
    {
      c=f.ChildControls[i];
      if((!c)||((visibleonly)&&(!c.Visible))) continue;
      if(c.DataBindings)
      {
        for(var j in c.DataBindings)
        {
          if((bindings)&&(typeof bindings[j] === 'undefined')) continue;
          b=c.DataBindings[j];
          if((ng_typeObject(b))&&(b.ValueAccessor))
          {
            v=b.ValueAccessor();
            if((v)&&(v.FieldDef)&&(v.FieldDef.ID==fid)&&(ngVal(v.FieldDef.Parent,null)===parentfielddef)) { found.push(c); break; }
          }
        }
      }
      findfield(c);
    }
  }
  findfield(this);
  return found;
}

function ngvmf_ResetErrors()
{
  if((this.OnResetErrors)&&(!ngVal(this.OnResetErrors(this),false))) return;

  if(this.ErrorHint) this.ErrorHint.SetVisible(false);

  function reseterrors(f)
  {
    if(!ng_typeObject(f.ChildControls)) return false;
    var c;
    for(var i=0;i<f.ChildControls.length;i++)
    {
      c=f.ChildControls[i];
      if((!c)||((ng_typeObject(c.DataBindings))&&(c.DataBindings['Error']))) continue;
      if(typeof c.SetErrorState === 'function') c.SetErrorState(false);
      else
      {
        c.ErrorMessage='';
        if(typeof c.SetInvalid === 'function') c.SetInvalid(false);
      }
      reseterrors(c);
    }
    return false;
  }
  reseterrors(this);
}

var ngvmf_active_errorhints = new Array();

function ngvmf_HideErrorHintEvent(e)
{
  var hints=ngvmf_active_errorhints;
  if(hints)
    for(var i=hints.length-1;i>=0;i--)
      hints[i].SetVisible(false);
  return true;
}

function ngvmf_ErrorHintVisibleChanged(c)
{
  var hints=ngvmf_active_errorhints;
  for(var i=0;i<hints.length;i++)
  {
    if(hints[i]==c)
    {
      if(c.Visible) return;
      hints.splice(i,1);
      return;
    }
  }
  if(c.Visible) hints.push(c);
}

function ngvmf_FocusControl(c)
{
  if(!c) return;
  if(this.OnSetControlFocus) this.OnSetControlFocus(this,c);
  else
  {
    c.SetFocus(false);
    c.SetFocus();
  }
}

function ngvmf_ShowControlError(c,err,setfocus)
{
  if(!c) return;
  if((err===false)||(err===null)) err='';
  err=(ng_typeString(err) ? err : ng_ViewModelFormatError(err));
  c.ErrorMessage=err;

  if((this.OnSetControlError)&&(!ngVal(this.OnSetControlError(form,c,err,setfocus),false))) return;

  if(typeof c.SetErrorState === 'function') c.SetErrorState(err!='');
  else
    if (typeof c.SetInvalid === 'function') c.SetInvalid(err!='');

  if(err==='')
  {
    this.HideControlError(c);
    return;
  }
  else
    if(ngVal(setfocus,false))
    {
      if(typeof c.SetErrorState !== 'function') // Not Edit field
      {
        var hint=this.GetErrorHint();
        if(hint)
        {
          if(ng_isEmpty(c.HintX)) c.HintX=0;
          if(typeof hint.SetText === 'function') hint.SetText(err);
          hint.ErrorControl=c;
          hint.ErrorMessage=err;
          hint.PopupCtrl(c);
          if(!ngvmf_hintevents_initialized)
          {
            document.onmousedown = ngAddEvent(ngvmf_HideErrorHintEvent, document.onmousedown);
            document.onkeydown = ngAddEvent(ngvmf_HideErrorHintEvent, document.onkeydown);
            ngvmf_hintevents_initialized = true;
          }
        }
      }
      this.FocusControl(c);
    }
}

function ngvmf_HideControlError(c)
{
  var hint=this.GetErrorHint();
  if(hint)
  {
    if((!c)||(c===hint.ErrorControl)) hint.SetVisible(false);
  }
}

function ngvmf_ShowErrors(errors)
{
  if((typeof errors==='undefined')&&(ng_typeObject(this.ViewModel))) errors=this.ViewModel.IsValid();
  if(!ng_typeObject(errors)) return false;

  for(var i in errors) // tests if errors exists
  {
    if(this.OnShowErrors) this.OnShowErrors(this,ng_ViewModelFormatError(errors),errors);
    else
    {
      var form=this;

      var msg=[],fieldcontrols=[];
      function showerrors(err)
      {
        if(!ng_typeObject(err)) return;

        if(!(err instanceof ngFieldDefException))
        {
          for(var i in err)
          {
            if(err[i] instanceof ngFieldDefException) showerrors(err[i]);
          }
        }
        else
        {
          var m,emsg;

          if(ngIsFieldDef(err.FieldDef))
          {
            var controlsfound=false;

            function findchildfieldcontrols(err) {
              var lvl=0;

              if(ng_typeObject(err.ChildErrors)) {
                var cerr;
                for(var i in err.ChildErrors) {
                  cerr=err.ChildErrors[i];
                  if(cerr instanceof ngFieldDefException) {
                    var l=findchildfieldcontrols(cerr);
                    if(l>lvl) lvl=l;
                  }
                  if(ngIsFieldDef(cerr.FieldDef)) {
                    var ctrls=form.FindFieldControls(cerr.FieldDef.ID,false,undefined,err.FieldDef);
                    if(ctrls.length>0)
                    {
                      controlsfound=true;
                      for(var j=0;j<ctrls.length;j++)
                        fieldcontrols.push({ Control: ctrls[j], Err: cerr, Level: lvl});
                    }
                  }
                }
                lvl++;
              }
              return lvl;
            }
            var lvl=findchildfieldcontrols(err);

            var ctrls=form.FindFieldControls(err.FieldDef.ID,false);
            if(ctrls.length>0)
            {
              controlsfound=true;
              for(var j=0;j<ctrls.length;j++)
                fieldcontrols.push({ Control: ctrls[j], Err: err, Level: lvl});
            }
            if(controlsfound) return;

            dn=ng_Trim(err.FieldDef.GetDisplayName());
            if(dn.length>0)
            {
              if(dn.charAt(dn.length-1)!=':') dn+=': ';
              else dn+=' ';
            }
            emsg=ng_ViewModelFormatError(err);
          }
          else
          {
            emsg=ng_ViewModelFormatError(err);
            if(ng_typeString(err.FieldDef)) dn=err.FieldDef+': ';
            else dn='';
          }
          if((ng_typeString(emsg))&&(emsg!==''))
          {
            m=dn+emsg;
            if(!ng_inArray(m,msg)) msg.push(m);
          }
          if(ng_typeObject(emsg))
          {
            for(var j in emsg)
            {
              m=dn+emsg[j]
              if(!ng_inArray(m,msg)) msg.push(m);
            }
          }
        }
      }
      showerrors(errors);
      if(fieldcontrols.length>0)
      {
        var focuscontrol=[];
        function focusfield(f)
        {
          if(!ng_typeObject(f.ChildControls)) return false;
          var c;
          for(var i=0;i<f.ChildControls.length;i++)
          {
            c=f.ChildControls[i];
            if((!c)||(!c.Visible)) continue;
            for(var j=0;j<fieldcontrols.length;j++)
            {
              if(c===fieldcontrols[j].Control)
              {
                var p=c.ParentControl;
                while(p)
                {
                  if(!p.Visible) break;
                  p=p.ParentControl;
                }
                if(!p)
                {
                  focuscontrol[fieldcontrols[j].Level]=j;
                  if(!fieldcontrols[j].Level) return true;
                }
              }
            }
            if(focusfield(c)) return true;
          }
          return false;
        }
        focusfield(this);

        if(!focuscontrol.length)
        {
          var focusfound=false;
          if((this.OnSetControlVisible)&&(ngVal(this.OnSetControlVisible(this,fieldcontrols[0].Control),false)))
          {
            focusfield(this);
            focusfound=true;
          }

          if(!focusfound)
          {
            var err,dn,m;
            for(var i=0;i<fieldcontrols.length;i++)
            {
              err=fieldcontrols[i].Err;
              dn=ng_Trim(err.FieldDef.GetDisplayName());
              if(dn.length>0)
              {
                if(dn.charAt(dn.length-1)!=':') dn+=': ';
                else dn+=' ';
              }
              var emsg=ng_ViewModelFormatError(err);
              if((ng_typeString(emsg))&&(emsg!==''))
              {
                m=dn+emsg;
                if(!ng_inArray(m,msg)) msg.push(m);
              }
              if(ng_typeObject(emsg))
              {
                for(var j in emsg)
                {
                  m=dn+emsg[j]
                  if(!ng_inArray(m,msg)) msg.push(m);
                }
              }
            }
          }
        }

        var fc=-1;
        for(var j=0;j<focuscontrol.length;j++)
          if(typeof focuscontrol[j]!=='undefined') { fc=focuscontrol[j]; break; }

        for(var j=0;j<fieldcontrols.length;j++)
          if(j!=fc) this.ShowControlError(fieldcontrols[j].Control,fieldcontrols[j].Err);

        if(fc>=0) this.ShowControlError(fieldcontrols[fc].Control,fieldcontrols[fc].Err,true);
      }
      if(msg.length>0)
      {
        msg=msg.join("\n");
        if(this.OnShowErrorMsg) form.OnShowErrorMsg(this,msg);
        else alert(msg);
      }
    }
    return true;
  }
  return false;
}

function ngvmf_SetViewModel(vm)
{
  if(ng_typeString(vm)) vm=getViewModelById(vm);
  if((vm)&&(vm.ViewModelForm)) return;
  var ovm=this.ViewModel;
  if(ng_typeObject(ovm))
  {
    if(typeof ovm.RemoveEvent === 'function') { // check if not pure ViewModel
      ovm.RemoveEvent('OnShowErrors',ngvmf_OnShowErrors);
      ovm.RemoveEvent('OnCommand',ngvmf_OnCommand);
      ovm.RemoveEvent('OnCommandRequest',ngvmf_OnCommandRequest);
      ovm.RemoveEvent('OnCommandResults',ngvmf_OnCommandResults);
      ovm.RemoveEvent('OnCommandFinished',ngvmf_OnCommandFinished);
      ovm.RemoveEvent('OnCommandCancel',ngvmf_OnCommandCancel);
    }
    delete ovm.ViewModelForm;
  }
  this.ViewModel=vm;
  if(ng_typeObject(vm))
  {
    vm.ViewModelForm=this;
    if(typeof vm.AddEvent === 'function') { // check if not pure ViewModel
      vm.AddEvent('OnShowErrors',ngvmf_OnShowErrors);
      vm.AddEvent(ngvmf_OnCommand,'OnCommand');
      vm.AddEvent('OnCommandRequest',ngvmf_OnCommandRequest);
      vm.AddEvent('OnCommandResults',ngvmf_OnCommandResults);
      vm.AddEvent('OnCommandFinished',ngvmf_OnCommandFinished);
      vm.AddEvent('OnCommandCancel',ngvmf_OnCommandCancel);
    }
  }
  if(this.OnSetViewModel) this.OnSetViewModel(this,vm,ovm);
}

function ngvmf_ShowLoading(v)
{
  if((v)&&(this.OnShowLoading)) { this.OnShowLoading(this); return; }
  if((!v)&&(this.OnHideLoading)) { this.OnHideLoading(this); return; }

  if(ng_typeObject(this.Controls)&&(typeof this.Controls.Loading === 'object')&&(typeof this.Controls.Loading.SetVisible === 'function')) this.Controls.Loading.SetVisible(v);
}

function ngvmf_GetErrorHint()
{
  if(!this.ErrorHint)
  {
    var ldefs = {
      ErrorHint: this.ErrorHintDef
    };
    var lref=ngCreateControls(ldefs,undefined,ngApp ? ngApp.TopElm() : undefined);
    this.ErrorHint=ngVal(lref.ErrorHint,null);
    if(this.ErrorHint)
    {
      ngAddChildControl(this,this.ErrorHint);
      this.ErrorHint.AddEvent(ngvmf_ErrorHintVisibleChanged,'OnVisibleChanged');
    }
  }
  return this.ErrorHint;
}

/*  Class: ngViewModelForm
 *  View model form control (based on <ngFrame>).
 */
/*<>*/
function Create_ngViewModelForm(def, ref, parent)
{
  ng_MergeDef(def, {
    ParentReferences: false,
    ErrorHint: {
      Type: 'ngTextHint',      
      ParentReferences: false,
      Data: {
        IsPopup: true
      }
    }
  });
  var c=ngCreateControlAsType(def, 'ngFrame', ref, parent);
  if(!c) return c;

  def.OnCreated=ngAddEvent(def.OnCreated, function (c, ref) {
    if(typeof c.FormID === 'undefined') c.FormID=c.ID; // make default buttons in form

    var vm=null;
    if(typeof def.ViewModel === 'undefined')
    {
      if((c.Controls)&&(c.Controls.ViewModel)) vm=c.Controls.ViewModel;
    }
    if(!ng_typeObject(vm)) vm=ng_FindViewModel(def, c);
    if(ng_typeObject(vm)) c.SetViewModel(vm);

  });
  
  c.disablectrlscnt=0;

  /*
   *  Group: Properties
   */
  c.DefaultFindFieldControlsBindings=['Data','Value','Checked','Selected','Lookup','Error','Link'];

  c.ErrorHintDef = def.ErrorHint;
  c.ErrorHint = null;

  c.DisableOnCommand = true;

  /*
   *  Group: Methods
   */
  c.DoDispose = ngvmf_DoDispose;
  c.SetChildControlsEnabled = ngvmf_SetChildControlsEnabled;

  c.GetErrorHint = ngvmf_GetErrorHint;
  c.DisableControls = ngvmf_DisableControls;
  c.EnableControls = ngvmf_EnableControls;
  c.EnableControl = ngvmf_EnableControl;
  c.ShowControl = ngvmf_ShowControl;

  c.FindFieldControl = ngvmf_FindFieldControl;
  c.FindFieldControls = ngvmf_FindFieldControls;

  c.FocusControl = ngvmf_FocusControl;
  c.ShowControlError = ngvmf_ShowControlError;
  c.HideControlError = ngvmf_HideControlError;

  c.SetViewModel = ngvmf_SetViewModel;
  c.ResetErrors = ngvmf_ResetErrors;
  c.ShowErrors = ngvmf_ShowErrors;
  c.ShowLoading = ngvmf_ShowLoading;

  /*
   *  Group: Events
   */
  c.OnSetViewModel = null;
  c.OnResetErrors = null;
  c.OnShowErrors = null;

  c.OnFindFieldControls = null;
  c.OnSetControlError = null;

  c.OnSetControlVisible = null;
  c.OnSetControlFocus = null;

  c.OnShowLoading = null;
  c.OnHideLoading = null;
  c.OnShowErrorMsg = null;

  c.OnCommand = null;
  c.OnCommandRequest = null;
  c.OnCommandResults = null;
  c.OnCommandFinished = null;
  c.OnCommandCancel = null;

  return c;
}

function ngve_GetFieldDefs()
{
  var fdefs=[];
  if(this.DataBindings)
  {
    var bind;
    for(var i=0;i<this.ErrorBindings.length;i++)
    {
      bind=this.DataBindings[this.ErrorBindings[i]];
      if(ng_typeObject(bind))
      {
        var v=bind.ValueAccessor();
        if((v)&&(ng_typeObject(v.FieldDef))) fdefs.push(v.FieldDef);
      }
    }
  }
  return fdefs;
}

function ngve_Validate()
{
  var err,fd,singleerr;
  var errs={};
  var fdefs=this.GetFieldDefs();
  for(var i=0;i<fdefs.length;i++)
  {
    fd=fdefs[i];
    err=fd.Validate(fd.Value());
    if(err===true) continue;
    if(ng_isEmpty(singleerr)) singleerr=err;
    else singleerr=null;
    errs[fd.ID]=err;
  }
  if(ng_isEmpty(singleerr)) return true;
  if(singleerr!==null) return singleerr;
  return errs;
}


function ngve_GetErrorHint()
{
  if(!this.ErrorHint)
  {
    var ldefs = {
      ErrorHint: this.ErrorHintDef
    };
    var lref=ngCreateControls(ldefs,undefined,ngApp ? ngApp.TopElm() : undefined);
    this.ErrorHint=ngVal(lref.ErrorHint,null);
    if(this.ErrorHint) {
      var self=this;
      this.ErrorHint.AddEvent('OnIsInsidePopup', function (h,t,w,pi) {
        return (ngGetControlByElement(t)===self);
      });
      ngAddChildControl(this,this.ErrorHint);
    }
  }
  return this.ErrorHint;
}

function ngve_ShowErrorHint(msg)
{
  msg=ngVal(msg,this.ErrorMessage);
  if(ng_EmptyVar(msg))
  {
    this.HideErrorHint();
    this.ErrorMessage='';
    return;
  }
  this.ErrorMessage=msg;
  this.SetErrorState(true);

  if((this.OnShowErrorHint)&&(!ngVal(this.OnShowErrorHint(this,msg),false))) return;

  var hint=this.GetErrorHint();
  if(!hint) return;
  if(typeof hint.SetText === 'function')
  {
    if(ng_IsArrayVar(msg)) msg=msg.join("<br/>");
    hint.SetText(msg);
  }
  hint.PopupCtrl(this);
}

function ngve_HideErrorHint()
{
  if((this.OnHideErrorHint)&&(!ngVal(this.OnHideErrorHint(this),false))) return;
  if(this.ErrorHint) this.ErrorHint.SetVisible(false);
}

function ngve_SetErrorState(state)
{
  if(this.ErrorState == state) return;
  
  if((this.OnSetErrorState)&&(!ngVal(this.OnSetErrorState(this,state),false))) return;

  this.ErrorState = state;

  if(!state)
  {
    this.HideErrorHint();
    this.ErrorMessage='';
  }
  if(typeof this.SetInvalid === 'function') this.SetInvalid(state ? true : false);
}

function ngve_SetEditText(t)
{
  this.__setEditText=true;
  try 
  {
    this.SetText(t);
  }
  finally
  {
    delete this.__setEditText;
  }
}

/*  Class: ngEditField
 *  Edit field control (based on <ngEdit>).
 */
/*<>*/
function Create_EditField(def, ref, parent, basetype)
{
  var c=ngCreateControlAsType(def, ngVal(basetype,'ngEdit'), ref, parent);
  if(!c) return c;

  ng_MergeDef(def.ErrorHint, {
      Type: 'ngTextHint',
      ParentReferences: false,
      Data: {
        IsPopup: true
      }      
    });

  /*
   *  Group: Properties
   */
  c.ErrorHintDef = def.ErrorHint;
  c.ErrorHint = null;
  c.ErrorMessage = '';

  c.ErrorState = false;

  c.ErrorBindings = [ 'Value', 'Lookup' ];

  /*
   *  Group: Methods
   */
  c.GetFieldDefs = ngve_GetFieldDefs;
  c.GetErrorHint = ngve_GetErrorHint;

  c.ShowErrorHint = ngve_ShowErrorHint;
  c.HideErrorHint = ngve_HideErrorHint;
  c.SetErrorState = ngve_SetErrorState;

  c.Validate = ngve_Validate;

  /*
   *  Group: Events
   */
  c.OnSetErrorState = null;
  c.OnShowErrorHint = null;
  c.OnHideErrorHint = null;

  c.__ddlfDropDown = c.DropDown;
  c.__ddlfDoMouseDown = c.DoMouseDown;

  c.DoMouseDown = function(e) {
    if((c.HasFocus)||(!c.ErrorState))
      c.__ddlfDoMouseDown(e);
  }

  c.DropDown = function() {
    c.__ignoreerror=true;
    try {
      var ret=c.__ddlfDropDown();
    }
    finally {
      delete c.__ignoreerror;
    }
    return ret;
  }
    
  c.SetEditText = ngve_SetEditText;
  

  def.OnCreated=ngAddEvent(def.OnCreated, function (c, ref) {
    c.AddEvent('OnFocus', function(c) {
      if(c.ErrorState) {
        if(ng_EmptyVar(c.ErrorMessage))
        {
          var errors=c.Validate();
          if(errors!==true) c.ShowErrorHint(ng_ViewModelFormatError(errors));
          else c.SetErrorState(false);
        }
        else c.ShowErrorHint();
      }
      return true;
    });
    c.AddEvent('OnBlur', function(c) {
      if((ng_EmptyVar(c.ErrorMessage))&&(!c.__ignoreerror))
      {
        var errors=c.Validate();
        if(errors!==true) c.SetErrorState(true);
      }
      c.HideErrorHint();
      return true;
    });
    c.AddEvent('OnTextChanged', function (c,t) {
      if(!this.__setEditText)
        c.SetErrorState(false);
    });
  });
  return c;
}

function ng_FindViewModel(def, c)
{
  var vm=def.ViewModel;
  if(typeof vm==='undefined')
  {
    var p=c.ParentControl;
    while((p)&&(typeof vm==='undefined'))
    {
      vm=p.ViewModel;
      p=p.ParentControl;
    }
    if(typeof vm==='undefined')
    {
      var p=c.Owner;
      while((p)&&(typeof vm==='undefined'))
      {
        vm=p.ViewModel;
        p=p.Owner;
      }
    }
  }
  if(ng_typeString(vm))
  {
    var vmi=getViewModelById(vm);
    if(vmi) vm=vmi;
  }
  return vm;
}

if(typeof ngUserControls === 'undefined') ngUserControls = new Array();
ngUserControls['viewmodel_controls'] = {
  Lib: 'ng_controls',
  ControlsGroup: 'Core',

  OnControlCreated: function(def,c,ref) {
    if((typeof def.ViewModel !== 'undefined')&&(typeof c.ViewModel === 'undefined')) c.ViewModel=def.ViewModel;

    var bind=def.DataBind;
    if(typeof bind !== 'undefined') {
      def.OnCreated=ngAddEvent(def.OnCreated, function(c,ref) {
        var vm=ng_FindViewModel(def, c);

        if(typeof bind==='object')
        {
          for(var vm2 in bind)
            ngApplyBindings(c, (vm2=='self' ? vm : vm2), bind[vm2]);
          return true;
        }

        ngApplyBindings(c, vm, bind);
        return true;
      });
      delete def.DataBind;
    }
  },

  OnInit: function() {

    var vmdevice;
    var vmdeviceprofile;

    function vm_setdevice(device,dinfo) {
      var avm=ngApp.ViewModel;
      if(!avm) return;
      if(vmdevice()!=ngDevice) vmdevice(ngDevice);
      if(!ng_VarEquals(vmdeviceprofile(),ngDeviceProfile)) vmdeviceprofile(ngDeviceProfile);
    }

    var vmappwidth,vmappheight,vmwinwidth,vmwinheight;
    var vmresizetimer=null;
    function vm_onresize() {
      if(vmresizetimer) clearTimeout(vmresizetimer);
      vmresizetimer=setTimeout(function() {
        clearTimeout(vmresizetimer); vmresizetimer=null;
        var avm=ngApp.ViewModel;
        if(!avm) return;
        if(vmappwidth()!=ngApp.LastResizeW) vmappwidth(ngApp.LastResizeW);
        if(vmappheight()!=ngApp.LastResizeH) vmappheight(ngApp.LastResizeH);
        var ww=ng_WindowWidth();
        var wh=ng_WindowHeight();
        if(vmwinwidth()!=ww) vmwinwidth(ww);
        if(vmwinheight()!=wh) vmwinheight(wh);
      },80); // invoke before nga_DoResize ...<100
    }

    function vmtrackdevicechanged() {
      return true;
    }

    if(ngApp) {
      if((ngApp.ViewModel==='undefined')||(!ngApp.ViewModel))
        ngApp.ViewModel={};

      var avm=ngApp.ViewModel;

      vmappwidth=ko.observable(ngApp.LastResizeW);
      vmappheight=ko.observable(ngApp.LastResizeH);
      vmwinwidth=ko.observable(ng_WindowWidth());
      vmwinheight=ko.observable(ng_WindowHeight());

      avm.AppWidth=ko.computed(function() { return vmappwidth(); }, avm);
      avm.AppHeight=ko.computed(function() { return vmappheight(); }, avm);

      avm.WindowWidth=ko.computed(function() { return vmwinwidth(); }, avm);
      avm.WindowHeight=ko.computed(function() { return vmwinheight(); }, avm);

      if(typeof ngSetDevice==='function') {
        vmdevice=ko.observable(ngDevice);
        vmdeviceprofile=ko.observable(ngDeviceProfile);

        function ngdevice_computed() {
          return ko.computed({
          read: function() {
            return vmdevice();
          },
          write: function(value) {
            ngSetDevice(value);
          },
          owner:avm});
        }

        function ngdeviceprofile_computed() {
          return ko.computed(function() { return vmdeviceprofile(); }, avm);
        }
        avm.ngDevice=ngdevice_computed();
        avm.ngDeviceProfile=ngdeviceprofile_computed();

        var actdev=ngdevice_computed();
        var actdevprof=ngdeviceprofile_computed();

        var vmdynamicdeviceinit=false;

        var oldddsubscribe=actdev.subscribe;
        actdev.subscribe=function() {
          if(vmdynamicdeviceinit==false) {
            vmdynamicdeviceinit=true;
            ngApp.AddEvent('OnDeviceChanged',vmtrackdevicechanged);
          }
          return oldddsubscribe.apply(this, arguments);
        }

        var oldddprofsubscribe=actdevprof.subscribe;
        actdevprof.subscribe=function() {
          if(vmdynamicdeviceinit==false) {
            vmdynamicdeviceinit=true;
            ngApp.AddEvent('OnDeviceChanged',vmtrackdevicechanged);
          }
          return oldddprofsubscribe.apply(this, arguments);
        }
        avm.ngDeviceD=actdev;
        avm.ngDeviceProfileD=actdevprof;

        ngOnDeviceChanged=ngAddEvent(ngOnDeviceChanged,vm_setdevice);
      }

      window.onresize = ngAddEvent(window.onresize, vm_onresize);
    }

    ngRegisterControlType('ngSysViewModel',(function()
    {
      var fc=function(def, ref, parent) {
        var vm=new ngSysViewModel;
        if(!vm) return vm;
        vm.SetNamespace(ngVal(def.Namespace,vm.Namespace));
        if((ng_typeArray(def.FieldDefs))&&(def.FieldDefs.length>0))
        {
          function setfielddefs()
          {
            for(var i=0;i<def.FieldDefs.length;i++)
            {
              if(ngIsFieldDef(def.FieldDefs[i])) ko.ng_fielddef(this,def.FieldDefs[i]);
            }
          }
          vm.SetViewModel(setfielddefs);
        }
        if((typeof def.ViewModel === 'object')||(typeof def.ViewModel === 'function')) vm.SetViewModel(def.ViewModel);
        if((typeof def.Data === 'object')&&(typeof def.Data.ViewModel === 'object'))
        {
          vm.SetValues(def.Data.ViewModel);
          delete def.Data.ViewModel;
        }

        if(typeof def.RefViewModel !== 'undefined')
        {
          def.OnCreated=ngAddEvent(def.OnCreated, function (c, ref) {
            var refvm=def.RefViewModel;
            if(ng_typeString(refvm)) refvm=getViewModelById(refvm);
            if(refvm) vm.Assign(refvm);
          });
        }
        return vm;
      };
      fc.ControlsGroup='System';
      return fc;
    })());

    ngRegisterControlType('ngViewModelForm', function(def, ref, parent) { return Create_ngViewModelForm(def, ref, parent); });

    if(ngUserControls['settings'])
    {
      function ngsvmset_DoCreate(def,ref) {
      
        if((!this._settings)&&(typeof ngApp === 'object')&&(ngApp)&&(ng_typeObject(ngApp.Settings))) {
          this._settings=ngApp.Settings;
        }
        if(this._settings) {
          var self=this;
          this._settingsloaded=function(settings) {
            if(this.Enabled) {
              if(self.OnSettingsLoaded) self.OnSettingsLoaded(self,settings);
            } else self._changed=true;
          }
          this._settings.AddEvent('OnSettingsLoaded',this._settingsloaded);
        }
        if((this.Enabled)&&(this._settings)&&(!this._initialized)) {
          this._initialized=true;
          if(this.OnInitialized) this.OnInitialized(this,this._settings);
        }
      }

      function ngsvmset_DoSetEnabled(s) {
        this.Enabled=s;
        if((s)&&(this._settings)) {
          if(!this._initialized) {
            this._initialized=true;
            this._changed=false;
            if(this.OnInitialized) this.OnInitialized(this,this._settings);
          }
          if(this._changed) {
            this._changed=false;
            if(this._settingsloaded) this._settingsloaded(this._settings);
          }
        }
      }

      function ngsvmset_DoDispose() {
        if((this._settings)&&(this._settingsloaded)) {
          this._settings.RemoveEvent('OnSettingsLoaded',this._settingsloaded);
        }
        return true;
      }

      function ngsvmset_SetValues(values) {
        if((ng_typeObject(values))&&(this._settings)&&(this.Enabled)) {
          this._settings.BeginUpdate();
          try {
            for(var i in values) {
              this._settings.Set(i,values[i]);
            }
          }
          finally {
            this._settings.EndUpdate();
          }
        }
      }

      /**
       *  Class: ngSysViewModelSettings
       *  This class implements ngSysViewModelSettings non-visual control.
       *  Allows easy storage of ViewModel values into ngSettings.
       *
       *  Syntax:
       *    new *ngSysViewModelSettings* ([ngSettings settings, string id])
       *
       *  Parameters:
       *    settings - settings instance, ngApp.Settings is used if not provided
       *    id - control ID
       */
      window.ngSysViewModelSettings = function(settings,id)
      {
        ngSysControl(this, id, 'ngSysViewModelSettings');

        this._settings = ngVal(settings,null);
        this._changed = false;
        this._initialized = false;

        /*
         *  Group: Methods
         */
        /*  Function: SetValues
         *  Sets settings values.
         *
         *  Syntax:
         *    void *SetValues* (object values)
         *
         *  Parameters:
         *    values - object with values to be set
         *
         *  Returns:
         *    -
         */
        this.SetValues = ngsvmset_SetValues;

        this.DoCreate = ngsvmset_DoCreate;
        this.DoDispose = ngsvmset_DoDispose;
        this.DoSetEnabled = ngsvmset_DoSetEnabled;

        /*
         *  Group: Events
         */
        /*
         *  Event: OnSettingsLoaded
         */
        this.OnSettingsLoaded = null;
        /*
         *  Event: OnInitialized
         */
        this.OnInitialized = null;

        ngControlCreated(this);
      }

      ngRegisterControlType('ngSysViewModelSettings', (function()
      {
        var fc=function(def, ref, parent) {
          return new ngSysViewModelSettings(def.Settings);
        };
        fc.ControlsGroup='System';
        return fc;
      })());
    }

    ngRegisterControlType('ngEditField', function(def, ref, parent) { return Create_EditField(def, ref, parent); });

    /*  Class: ngEditNumField
     *  Edit number field control (based on <ngEditNum>).
     */
    /*<>*/
    ngRegisterControlType('ngEditNumField', function(def, ref, parent)
    {
      var c=Create_EditField(def, ref, parent, 'ngEditNum');
      if(!c) return c;

      c.AddEvent('OnGetNum',function(c) {
        var txt=c.GetText();
        var bind=(c.DataBindings ? c.DataBindings.Value : null);
        if(bind)
          return ng_toNumber(parse_text_value(bind.ValueAccessor,txt));
        var n=parseInt(txt);
        if(isNaN(n)) return undefined;

        if((typeof c.MinNum !== 'undefined')&&(n<c.MinNum)) n=c.MinNum;
        if((typeof c.MaxNum !== 'undefined')&&(n>c.MaxNum)) n=c.MaxNum;
        return n;
      });
      c.AddEvent('OnSetNum',function(c,n) {
        if((typeof c.MinNum !== 'undefined')&&(n<c.MinNum)) n=c.MinNum;
        if((typeof c.MaxNum !== 'undefined')&&(n>c.MaxNum)) n=c.MaxNum;

        var bind=(c.DataBindings ? c.DataBindings.Value : null);
        if(bind)
        {
          var modelValue = bind.ValueAccessor();
          if(ko.isObservable(modelValue))
          {
            if (ko.isWriteableObservable(modelValue))
            {
              modelValue(n);
              return;
            }
          }
        }
        c.SetText(''+n);
      });

      return c;
    });

    if(ngUserControls['calendar'])
    {
      /*  Class: ngEditDateField
       *  Edit date field control (based on <ngEditDate>).
       */
      /*<>*/
      ngRegisterControlType('ngEditDateField', function(def, ref, parent) { return Create_EditField(def, ref, parent, 'ngEditDate'); });

      /*  Class: ngEditTimeField
       *  Edit time field control (based on <ngEditTime>).
       */
      /*<>*/
      ngRegisterControlType('ngEditTimeField', function(def, ref, parent) { return Create_EditField(def, ref, parent, 'ngEditTime'); });
    }

    /*  Class: ngDropDownField
     *  Dropdown field control (based on <ngDropDown>).
     */
    /*<>*/
    ngRegisterControlType('ngDropDownField', function(def, ref, parent) { return Create_EditField(def, ref, parent, 'ngDropDown'); });

    /*  Class: ngDropDownListField
     *  Dropdown list field control (based on <ngDropDownList>).
     */
    /*<>*/
    ngRegisterControlType('ngDropDownListField', function(def, ref, parent) { return Create_EditField(def, ref, parent, 'ngDropDownList'); });

    /*  Class: ngMemoField
     *  Memo field control (based on <ngMemo>).
     */
    /*<>*/
    ngRegisterControlType('ngMemoField', function(def, ref, parent) { return Create_EditField(def, ref, parent, 'ngMemo'); });

    function value_lock(type,c,fnc) {
      type='binding_updating'+ngVal(type,'');
      if(c[type]) return false;
      c[type]=true;
      try {
        fnc();
      }
      finally { delete c[type]; }
      return true;
    }

    function value_write_ex(val,valueAccessor, allBindingsAccessor) {
      var modelValue = valueAccessor();
      val=ko.ng_setvalue(modelValue,val);
      if(!ko.isObservable(modelValue)) {
        var allBindings = allBindingsAccessor();
        if (allBindings['_ko_property_writers'] && allBindings['_ko_property_writers']['value']) {
          allBindings['_ko_property_writers']['value'](val);
        }
      }
      return (modelValue===val);
    }

    function value_write(type,val,c, valueAccessor, allBindingsAccessor, obj)
    {
      type='binding_updating'+ngVal(type,'');
      if(c[type]) return false;

      var ret=false;
      c[type]=true;
      try {
        ret=value_write_ex(val,valueAccessor, allBindingsAccessor);
      }
      finally { delete c[type]; }
      return ret;
    }
    window.ngCtrlBindingWrite = value_write;

    function value_read(type,c, valueAccessor, setfnc)
    {
      var val=ko.ng_getvalue(valueAccessor());
      return value_lock(type,c,function() {
        setfnc(val)
      });;
    }
    window.ngCtrlBindingRead = value_read;

    function format_text_value(valueAccessor, val)
    {
      var obval=valueAccessor();
      if((obval)&&(typeof obval.FieldDef !== 'undefined'))
      {
        if((arguments.length==1)&&(obval.FieldDef.Value)) val=obval.FieldDef.Value;
        return obval.FieldDef.FormatString(ko.ng_getvalue(val));
      }
      else
      {
        if(arguments.length==1) val=obval;
        return ng_toString(ko.ng_getvalue(val));
      }
    }
    window.ngCtrlBindingFormatString = format_text_value;

    function format_edit_value(valueAccessor, val)
    {
      var obval=valueAccessor();
      if((obval)&&(typeof obval.FieldDef !== 'undefined'))
      {
        if((arguments.length==1)&&(obval.FieldDef.Value)) val=obval.FieldDef.Value;
        return obval.FieldDef.EditString(ko.ng_getvalue(val));
      }
      else
      {
        if(arguments.length==1) val=obval;
        return ng_toString(ko.ng_getvalue(val));
      }
    }
    window.ngCtrlBindingEditString = format_edit_value;

    function parse_text_value(valueAccessor, val)
    {
      var obval=valueAccessor();
      if((obval)&&(typeof obval.FieldDef !== 'undefined')) return obval.FieldDef.ParseString(val);
      else return val;
    }
    window.ngCtrlBindingParseString = parse_text_value;

    ngRegisterBindingHandler('Visible',
      function (c, valueAccessor) {
        value_read('Visible',c,valueAccessor,function(val) {
          if(c.SetVisible) c.SetVisible(ng_toBool(val));
        });
      },
      function (c, valueAccessor, allBindingsAccessor,viewModel) {
        c.AddEvent(function(c) {
          value_write('Visible',c.Visible,c, valueAccessor, allBindingsAccessor);
        },'OnVisibleChanged');
      }
    );

    ngRegisterBindingHandler('Bounds',
      function (c, valueAccessor, allBindingsAccessor) {
        var binding=allBindingsAccessor();
        var boundsupdate = ngVal(binding["BoundsDelayedUpdate"],10);

        value_read('Bounds',c,valueAccessor,function(val) {
          if((!ng_typeObject(val))||(typeof c.SetBounds !== 'function')) return;
          if((c.SetBounds(val))&&(boundsupdate>=0)) {
            if(c._vmboundsupdtimer) clearTimeout(c._vmboundsupdtimer);
            if(boundsupdate>0) {
              c._vmboundsupdtimer=setTimeout(function() {
                if(c._vmboundsupdtimer) clearTimeout(c._vmboundsupdtimer);
                c._vmboundsupdtimer=null;
                if(c.Update) c.Update();
              },boundsupdate);
            }
            else if(c.Update) c.Update();
          }
        });
      },
      function (c, valueAccessor, allBindingsAccessor,viewModel) {
        if(typeof c.SetBounds === 'function') {
          var origsetbound=c.SetBounds;
          c.SetBounds=function(props) {
            var ret=origsetbound.apply(c,[props]);
            if(typeof props!=='undefined') {
              value_write('Bounds',props,c, valueAccessor, allBindingsAccessor);
            }
            return ret;
          };
          c.AddEvent(function() {
            if(c._vmboundsupdtimer) clearTimeout(c._vmboundsupdtimer);
            c._vmboundsupdtimer=null;
            return true;
          },'DoDispose');
        }
      }
    );

    ngRegisterBindingHandler('style',
      function (c, valueAccessor, allBindingsAccessor) {
        var elm=c.Elm();
        if(elm) {
          value_read('style',c,valueAccessor,function(val) {
            if(ng_typeObject(val)) {
              for(var i in val) {
                elm.style[i] = val[i] || ""; // Empty string removes the value, whereas null/undefined have no effect
              }
            }
          });
        }
      },
      null);

    ngRegisterBindingHandler('className',
      function (c, valueAccessor, allBindingsAccessor) {
        var elm=c.Elm();
        if(elm) {
          value_read('className',c,valueAccessor,function(val) {
            var bcls=val;
            var bi=bcls.indexOf(' ');
            if(bi>=0) bcls=bcls.substr(0,bi);
            elm.className=val;
            if(ngVal(c.BaseClassName,'')!=bcls) {
              c.BaseClassName=bcls;
              c.Update();
            }
          });
        }
      },
      null);

    ngRegisterBindingHandler('SubClassName',
      function (c, valueAccessor, allBindingsAccessor) {
        var elm=c.Elm();
        if(elm) {
          value_read('className',c,valueAccessor,function(val) {
            if(ngVal(c.BaseClassName,'')!='') val=c.BaseClassName+' '+val;
            elm.className=val;
          });
        }
      },
      null);

    ngRegisterBindingHandler('BaseClassName',
      function (c, valueAccessor, allBindingsAccessor) {
        var elm=c.Elm();
        if(elm) {
          value_read('className',c,valueAccessor,function(val) {
            if(ngVal(c.BaseClassName,'')!=val) {
              var bcls;
              var scls=elm.className;
              var bi=scls.indexOf(' ');
              if(bi>=0) bcls=scls.substr(0,bi);
              else      bcls=scls;
              if(ngVal(c.BaseClassName,'')==bcls) {
                if(bi>=0) scls=scls.substr(bi+1);
                else      scls='';
              }
              if((val!='')&&(scls!='')) scls=' '+scls;
              elm.className=val+scls;
              c.BaseClassName=val;
              c.Update();
            }
          });
        }
      },
      null);

    ngRegisterBindingHandler('Opacity',
      function (c, valueAccessor, allBindingsAccessor) {
        var elm=c.Elm();
        if(elm) {
          value_read('Opacity',c,valueAccessor,function(val) {
            c.SetOpacity(ng_toFloat(val));
          });
        }
      },
      function (c, valueAccessor, allBindingsAccessor,viewModel) {
        c.AddEvent(function(o) {
          value_write('Opacity',o,c, valueAccessor, allBindingsAccessor);
        },'SetOpacity');
      });

    function update_enabled(c,valueAccessor,inverse)
    {
      value_read('Enabled',c,valueAccessor,function(val) {
        val=ng_toBool(val);
        if(inverse) val=!val;
        if(c.SetEnabled) c.SetEnabled(val);
      });
    }

    function init_enabled(c,valueAccessor,allBindingsAccessor,inverse)
    {
      c.AddEvent(function(c) {
        value_write('Enabled',inverse ? !c.Enabled : c.Enabled,c, valueAccessor, allBindingsAccessor);
      },'OnEnabledChanged');
    }

    ngRegisterBindingHandler('Enabled',
      function (c, valueAccessor) {
        update_enabled(c,valueAccessor,false);
      },
      function (c, valueAccessor,allBindingsAccessor,viewModel) {
        init_enabled(c,valueAccessor,allBindingsAccessor,false);
      }
    );

    ngRegisterBindingHandler('Disabled',
      function (c, valueAccessor) {
        update_enabled(c,valueAccessor,true);
      },
      function (c, valueAccessor,allBindingsAccessor,viewModel) {
        init_enabled(c,valueAccessor,allBindingsAccessor,false);
      }
    );

    function update_text(c,valueAccessor,ngtxt)
    {
      value_read('Text',c,valueAccessor,function(val) {
        if(typeof c.SetText === 'function')
        {
          var txt=format_text_value(valueAccessor,val);
          if(ngtxt) txt=ngTxt(txt);
          c.SetText(txt);
        }
      });
    }

    function init_text(c,valueAccessor, allBindingsAccessor,viewModel)
    {
      if(typeof c.SetText === 'function')
        c.AddEvent(function(val) {
          var txt=parse_text_value(valueAccessor,val);
          value_write('Text',txt,c, valueAccessor, allBindingsAccessor);
        },'SetText');
    };

    ngRegisterBindingHandler('Text', function (c, valueAccessor) {
      update_text(c,valueAccessor,false);
    },init_text);
    ngRegisterBindingHandler('ngText', function (c, valueAccessor) {
      update_text(c,valueAccessor,true);
    },init_text);

    function update_textproperty(propid,c,valueAccessor,ngtxt)
    {
      if(typeof c[propid] === 'undefined') return;
      var val=ng_toString(ko.utils.unwrapObservable(valueAccessor()));
      var txt=format_text_value(valueAccessor,val);
      if(ngtxt) txt=ngTxt(txt);
      if(txt!=c[propid])
      {
        c[propid]=txt;
        c.Update();
      }
    }

    ngRegisterBindingHandler('Alt', function (c, valueAccessor) {
      update_textproperty('Alt',c,valueAccessor,false);
    });
    ngRegisterBindingHandler('ngAlt', function (c, valueAccessor) {
      update_textproperty('Alt',c,valueAccessor,true);
    });
    ngRegisterBindingHandler('Hint', function (c, valueAccessor) {
      update_textproperty('Hint',c,valueAccessor,false);
    });
    ngRegisterBindingHandler('ngHint', function (c, valueAccessor) {
      update_textproperty('Hint',c,valueAccessor,true);
    });

    ngRegisterBindingHandler('ReadOnly', function (c, valueAccessor) {
      var val=ng_toBool(ko.utils.unwrapObservable(valueAccessor()));
      if(typeof c.SetReadOnly === 'function')
        c.SetReadOnly(val);
      else
      {
        if(val!=ngVal(c.ReadOnly,false))
        {
          c.ReadOnly=val;
          c.Update();
        }
      }
    });

    ngRegisterBindingHandler('Invalid',
      function (c, valueAccessor) {
        value_read('Invalid',c,valueAccessor,function(val) {
          if(typeof c.SetInvalid === 'function')
            c.SetInvalid(ng_toBool(val));
        });
      },
      function (c, valueAccessor, allBindingsAccessor,viewModel) {
        if(typeof c.SetInvalid === 'function')
          c.AddEvent(function(v) {
            value_write('Invalid',v,c, valueAccessor, allBindingsAccessor);
          },'SetInvalid');
      }
    );

    ngRegisterBindingHandler('Valid',
      function (c, valueAccessor) {
        value_read('Invalid',c,valueAccessor,function(val) {
          if(typeof c.SetInvalid === 'function')
            c.SetInvalid(ng_toBool(val));
        });
      },
      function (c, valueAccessor, allBindingsAccessor,viewModel) {
        if(typeof c.SetInvalid === 'function')
          c.AddEvent(function(v) {
            value_write('Invalid',!v,c, valueAccessor, allBindingsAccessor);
          },'SetInvalid');
      }
    );

    ngRegisterBindingHandler('Focus',
      function (c, valueAccessor, allBindingsAccessor) {
        value_read('Focus',c,valueAccessor,function(val) {
           val=ng_toBool(val);
           if(c._controlfocused!=val)
            c.SetFocus(val);
        });
      },
      function (c, valueAccessor, allBindingsAccessor,viewModel) {
        value_write('Focus',false,c, valueAccessor, allBindingsAccessor);
        if(typeof c.OnFocus !== 'undefined') c.AddEvent('OnFocus', function(c) { c._controlfocused=true; value_write('Focus',true,c, valueAccessor, allBindingsAccessor); return true; });
        if(typeof c.OnBlur !== 'undefined') c.AddEvent('OnBlur', function(c) { value_write('Focus',false,c, valueAccessor, allBindingsAccessor); c._controlfocused=false; return true; });
      }
    );

    ngRegisterBindingHandler('MouseOver', null,
      function (c, valueAccessor, allBindingsAccessor,viewModel) {
        value_write('MouseOver',false,c, valueAccessor, allBindingsAccessor);
        c.AddEvent(function(c) { value_write('MouseOver',true,c, valueAccessor, allBindingsAccessor); },'OnMouseEnter');
        c.AddEvent(function(c) { value_write('MouseOver',false,c, valueAccessor, allBindingsAccessor); },'OnMouseLeave');
      }
    );

    ngRegisterBindingHandler('OnClick', null,
      function (c, valueAccessor, allBindingsAccessor, viewModel) {
        var fnc = function (event) {
          var handlerFunction = valueAccessor();
          if(ng_typeString(handlerFunction)) handlerFunction=viewModel[handlerFunction];
          if (!handlerFunction) return true;
          var allBindings = allBindingsAccessor();

          var argsForHandler = ko.utils.makeArray(arguments);
          argsForHandler.unshift(viewModel);
          return handlerFunction.apply(viewModel, argsForHandler);
        }
        c.AddEvent('OnClick', fnc);
      }
    );

    function event_init(eventtype, c, valueAccessor, allBindingsAccessor, viewModel) {
      var eventsToHandle = valueAccessor() || {};
      for(var eventNameOutsideClosure in eventsToHandle) {
          (function() {
              var eventName = eventNameOutsideClosure; // Separate variable to be captured by event handler closure
              if (typeof eventName === "string") {
                  var fnc = function (event) {
                      var handlerFunction = valueAccessor()[eventName];
                      if(ng_typeString(handlerFunction)) handlerFunction=viewModel[handlerFunction];
                      if (!handlerFunction) return true;
                      var allBindings = allBindingsAccessor();

                      // Take all the event args, and prefix with the viewmodel
                      var argsForHandler = ko.utils.makeArray(arguments);
                      argsForHandler.unshift(viewModel);
                      return handlerFunction.apply(viewModel, argsForHandler);
                  };
                  switch(eventtype)
                  {
                    case 1:
                      c.AddEvent(fnc,eventName);
                      break;
                    case 2:
                      c[eventName] = fnc;
                    default:
                      c.AddEvent(eventName, fnc);
                      break;
                  }
              }
          })();
      }
    }

    ngRegisterBindingHandler('Events', null,
      function (c, valueAccessor, allBindingsAccessor, viewModel) {
        event_init(0, c, valueAccessor, allBindingsAccessor, viewModel)
      }
    );
    ngRegisterBindingHandler('AfterEvents', null,
      function (c, valueAccessor, allBindingsAccessor, viewModel) {
        event_init(0, c, valueAccessor, allBindingsAccessor, viewModel)
      }
    );
    ngRegisterBindingHandler('BeforeEvents', null,
      function (c, valueAccessor, allBindingsAccessor, viewModel) {
        event_init(1, c, valueAccessor, allBindingsAccessor, viewModel)
      }
    );
    ngRegisterBindingHandler('OverrideEvents', null,
      function (c, valueAccessor, allBindingsAccessor, viewModel) {
        event_init(2, c, valueAccessor, allBindingsAccessor, viewModel)
      }
    );

    ngRegisterBindingHandler('Calls', null,
      function (c, valueAccessor, allBindingsAccessor, viewModel) {
        var callsToHandle = valueAccessor() || {};
        for(var eventNameOutsideClosure in callsToHandle) {
            (function() {
                var eventName = eventNameOutsideClosure; // Separate variable to be captured by event handler closure
                if (typeof eventName === "string") {
                    var fnc = function () {
                        var handlerFunction = valueAccessor()[eventName];
                        if(ng_typeString(handlerFunction)) handlerFunction=c[handlerFunction];
                        if (!handlerFunction) return true;
                        return handlerFunction.apply(c, arguments);
                    };
                    ngObjAddEvent.apply(viewModel,[eventName, fnc]);
                }
            })();
        }

      }
    );

    ngRegisterBindingHandler('Data',
      function (c, valueAccessor, allBindingsAccessor) {
        value_read('Data',c,valueAccessor,function(val) {
          if(c.SetViewModelData) c.SetViewModelData(val);
        });
      },
      function (c, valueAccessor, allBindingsAccessor,viewModel) {
        var undefined;
        c.OnViewModelDataChanged = c.OnViewModelDataChanged || null;
        c.ViewModelData=undefined;
        if(typeof c.SetViewModelData !== 'function')
          c.SetViewModelData = function (val)
          {
            if(ng_VarEquals(c.ViewModelData,val)) return;
            var oldval=c.ViewModelData;
            c.ViewModelData=val;
            if(c.OnViewModelDataChanged) c.OnViewModelDataChanged(c,oldval)
            value_write('Data',val,c, valueAccessor, allBindingsAccessor);
          }
      }
    );

    function vmGetListItem(list,v,subitems) {
      if((typeof v==='undefined')||(v===null)) return v;
      var c=v;
      v=ko.ng_unwrapobservable(c);
      if((!ng_typeObject(v))||(ng_typeDate(v))) {
        if(list.Columns.length>0) {
          var it={ Text: {} };
          it.Text[list.Columns[0]]=v;
          return it;
        }
        return {Text: v};
      }

      var items;
      if(typeof v.Items!=='undefined') {
        items=v.Items;
        v.Items=null;
        c=ko.ng_getvalue(v);
        v.Items=items;
      }
      else c=ko.ng_getvalue(v);

      if(v===c) c=ng_CopyVar(v);
      else {
        if(ko.isObservable(v.Checked))   c._vmChecked=v.Checked;
        if(ko.isObservable(v.Collapsed)) c._vmCollapsed=v.Collapsed;
      }
      //console.log(v);

      if(subitems!==false) {
        if(ko.isObservable(items)) items=items();
        if(ng_IsArrayVar(items)) {
          c.Items=[];
          for(var i in items)
            c.Items[i]=vmGetListItem(list,items[i]);
        }
        else delete c.Items;
      }
      return c;
    }

    function vmSetListItem(list,vmit,it,bindinfo,syncsubitems) {

      var vmval=ko.ng_unwrapobservable(vmit);
      if((vmval!==vmit)&&(!ko.isWriteableObservable(vmit))) return vmit;

      if(!ng_typeObject(vmval)) {

        if(bindinfo.SimpleArray) {
          if((typeof it.Items==='undefined')||(!it.Items.length)) {
            if(ng_typeString(it.Text)) it=it.Text;
            else if((list.Columns.length>0)&&(typeof it.Text==='object')) it=it.Text[list.Columns[0]];
          }
        }

        if(vmval!==vmit) {
          vmit(it);
          return vmit;
        }
        if(!ng_typeObject(it)) return it;
        if(vmval!==vmit) vmval={};
        else {
          vmit=vmval={};
        }
      }

      var ex={ Items: true }; // Don't touch original items
      if((vmit!==vmval)&&(typeof vmit.valueWillMutate === 'function')) vmit.valueWillMutate();
      for(var i in it) {
        switch(i) {
          case 'Items':
          case 'Parent':
          case '_byRef':
          case '_vmChecked':
          case '_vmCollapsed':
            break;
          default:
            ex[i]=true;
            vmval[i]=ko.ng_setvalue(vmval[i],it[i]);
            break;
        }
      }
      var nv,delkeys={}
      for(var i in vmval) {
        if((ex[i])||(ko.isObservable(vmval[i]))) continue;
        if((ng_typeObject(vmval[i]))&&(!ng_typeDate(vmval[i]))) {
          nv=ko.ng_getvalue(vmval[i]); // detect if object has observables
          if(nv!==vmval[i]) {
            continue;
          }
        }
        delkeys[i]=true;
      }
      for(var i in delkeys) delete vmval[i];

      var items=it.Items;
      var vitems=vmval.Items;

      if(ng_IsArrayVar(items)) {
        if(ko.isObservable(vitems)) {
          if(ko.isWriteableObservable(vitems)) {
            var aitems=vitems();
            var isarray=true;
            if(!ng_IsArrayVar(aitems)) { aitems=[]; isarray=false; }
            if(typeof vitems.valueWillMutate === 'function') vitems.valueWillMutate();
            syncsubitems(aitems,it);
            if((isarray)&&(typeof vitems.valueHasMutated === 'function')) vitems.valueHasMutated();
            else vitems(aitems);
          }
        }
        else {
          if(!ng_IsArrayVar(vitems)) {
            vitems=[];
            vmval.Items=vitems;
          }
          syncsubitems(vitems,it);
        }
      }
      else {
        if(ko.isObservable(vitems)) {
          if(ko.isWriteableObservable(vitems)) {
            var undefined;
            vitems(undefined);
          }
        }
        else delete vmval.Items;
      }

      if(vmit!==vmval) {
        if(typeof vmit.valueHasMutated === 'function') vmit.valueHasMutated();
        else vmit(vmval);
      }
      return vmit;
    }

    var ignoredListItemsProps = {
      _byRef: true,
      Items: true,
      Parent: true,
      Checked: true,
      Collapsed: true,
      _vmChecked: true,
      _vmCollapsed: true
    };

    function compareListItems(a,b,bindinfo)
    {
      if(typeof bindinfo.KeyField !== 'undefined') {
        if((!a)||(!b)) return false;
        return ng_VarEquals(vmGetFieldValueByID(a,bindinfo.KeyField),vmGetFieldValueByID(b,bindinfo.KeyField));
      }

      var keys={};
      for(var i in a) if(!ignoredListItemsProps[i]) keys[i]=true;
      for(var i in b) if(!ignoredListItemsProps[i]) keys[i]=true;

      var aref=a['_byRef'];
      var bref=b['_byRef'];
      for(var i in keys)
        if(!ng_VarEquals(a[i],b[i],((aref)&&(aref[i]))||((bref)&&(bref[i])))) return false;

      return true;
    }

    function value_init(c, valueAccessor, allBindingsAccessor, viewModel) {
      if(c.CtrlType==='ngList')
      {
        var bindinfo={},undefined;
        var binding=allBindingsAccessor();
        bindinfo.DelayedUpdate = ngVal(binding["DelayedUpdate"],10);
        bindinfo.KeyField  = binding["KeyField"];

        function compareListItems_init(a,b) {
          return compareListItems(a,b,bindinfo);
        }

        function newlistitem(it) {
          var ci = {
            NewItem: (bindinfo.SimpleArray ? undefined : {}),
            BindInfo: bindinfo,
            List: c,
            ListItem: it
          };
          // List event: OnCreateViewModelItem
          if((c.OnCreateViewModelItem)&&(!ngVal(c.OnCreateViewModelItem(c,ci),false))) return ci.NewItem;
          return vmSetListItem(c,ci.NewItem,ci.ListItem,bindinfo,newlistsubitems);
        }

        function newlistsubitems(vitems,it) {
          for(var i=0;i<it.Items.length;i++)
            vitems[i]=newlistitem(it.Items[i]);
        }

        function synclistinit(arr, parent)
        {
          var items=[];
          for(var i=0;i<arr.length;i++)
            items[i]=vmGetListItem(c,arr[i],false);

          var editScript=ng_GetArraysEditScript(items,parent.Items,compareListItems_init);
          for (var i = 0, j = 0; i < editScript.length; i++) {
            switch (editScript[i].status) {
              case 0://"retained":
                arr[j]=vmSetListItem(c,arr[j],parent.Items[j],bindinfo,synclistinit);
                //console.log('init retained',arr[j]);
                j++;
                break;
              case 2://"deleted":
                //console.log('init deleted',j);
                arr.splice(j,1);
                break;
              case 1://"added":
                arr.splice(j,0,newlistitem(parent.Items[j]));
                //console.log('init added',arr[j]);
                j++;
                break;
            }
          }
        }

        function updatelist()
        {
          //console.log('listupdated',c);
          if(c._vmdispose) return;

          if(c.binding_update_timer) clearTimeout(c.binding_update_timer);
          c.binding_update_timer=null;

          value_lock('Value',c,function() {
            var v=valueAccessor();
            if((v)&&(ko.isWriteableObservable(v))) {

              var fd=v.FieldDef;
              bindinfo.SimpleArray=((ng_typeObject(fd))&&(ng_typeObject(fd.ValueFieldDef))&&(fd.ValueFieldDef.DataType!=='OBJECT')); // simple array is ngFieldDef_Array of simple types

              var varr=v();
              if(!ng_IsArrayVar(varr))
              {
                var arr=[];
                synclistinit(arr, c);
                v(arr);
              }
              else
              {
                if(typeof v.valueWillMutate === 'function') v.valueWillMutate();
                synclistinit(varr, c);
                if(typeof v.valueHasMutated === 'function') v.valueHasMutated();
                else v(varr);
              }
            }
          });
        }

        function listupdated()
        {
          if(c._vmdispose) return;

          c.need_vmupdate=false;
          if(bindinfo.DelayedUpdate<=0) updatelist();
          else {
            if(c.binding_update_timer) clearTimeout(c.binding_update_timer);
            c.binding_update_timer=setTimeout(updatelist,bindinfo.DelayedUpdate);
          }
        }

        if(typeof c.UpdateVMValues !== 'function') {
          c.UpdateVMValues = function() {
            if((c['binding_updatingValue'])||(c._vmdispose)) return;
            if(c.update_cnt>0) c.need_vmupdate=true;
            else listupdated();
          }
        }

        c.AddEvent(function() {
          if((c.need_vmupdate)&&(c.update_cnt<=1)) {
            listupdated();
          }
        },'EndUpdate');

        c.need_vmupdate = false;
        c.binding_update_timer = null;

        c.OnCreateViewModelItem = c.OnCreateViewModelItem || null;

        c.AddEvent(function(l,it,parent) {
          c.UpdateVMValues();
        },'OnItemsChanged');
        c.AddEvent(function() {
          if(c.binding_update_timer) clearTimeout(c.binding_update_timer);
          c.binding_update_timer=null;
          c._vmdispose=true;
          return true;
        },'DoDispose');
        c.AddEvent(function(l,it) {
          if(c._vmdispose) return;
          if(ko.isObservable(it._vmCollapsed)) {
            if(!ko.isWriteableObservable(it._vmCollapsed)) return;
              value_lock('Value',c,function() {
                it._vmCollapsed(true);
              });
          }
          else c.UpdateVMValues();
        },'OnCollapsed');
        c.AddEvent(function(l,it) {
          if(c._vmdispose) return;
          if(ko.isObservable(it._vmCollapsed)) {
            if(!ko.isWriteableObservable(it._vmCollapsed)) return;
            value_lock('Value',c,function() {
              it._vmCollapsed(false);
            });
          }
          else c.UpdateVMValues();
        },'OnExpanded');
        c.AddEvent(function(l,it) {
          if(c._vmdispose) return;
          if(ko.isObservable(it._vmChecked)) {
            if(!ko.isWriteableObservable(it._vmChecked)) return;
            value_lock('Value',c,function() {
              it._vmChecked(it.Checked);
            });
          }
          else c.UpdateVMValues();
        },'OnItemCheckChanged');

        return;
      }

      switch(c.CtrlType)
      {
        case 'ngEdit':
          if((typeof c.DoUp === 'function')&&(c.CtrlInheritsFrom('ngEditNum')))
          {
            if(c.OnGetText === ngedn_GetText)
              delete c.OnGetText; // Remove ngEditNum GetText handler, ViewModel do all check stuff itself

            var v=valueAccessor();
            if((v)&&(typeof v.FieldDef !== 'undefined'))
            {
              var n,fd=v.FieldDef;
              if(!ng_isEmpty(fd.MinValue))
              {
                n=parseInt(fd.MinValue,10);
                if(!isNaN(n)) c.MinNum=n;
              }
              if(!ng_isEmpty(fd.MaxValue))
              {
                n=parseInt(fd.MaxValue,10);
                if(!isNaN(n)) c.MaxNum=n;
              }
              if(!ng_isEmpty(fd.DefaultValue)) 
              {
                n=parseInt(fd.DefaultValue,10);
                if(!isNaN(n)) c.DefaultNum=n;
              }
              if(!ng_isEmpty(fd.Attrs['EditNumStep']))
              {
                n=parseInt(fd.Attrs['EditNumStep'],10);
                if(!isNaN(n)) c.Step=n;
              }
              if(!ng_isEmpty(fd.Attrs['EditNumStepRound']))
              {
                c.StepRound=ng_toBool(fd.Attrs['EditNumStepRound']);
              }
            }                      
          }
        case 'ngMemo':          
          var binding=allBindingsAccessor();
          var instantupdate = ngVal(binding["InstantUpdate"],false);
          var updatedelay = ngVal(binding["DelayedUpdate"],500);
          c.AddEvent(function(c) {
            if(c.binding_update_timer) {
              clearTimeout(c.binding_update_timer);
              c.binding_update_timer=null;
            }
            if((instantupdate)||(!c.HasFocus))
            {
              var val=parse_text_value(valueAccessor,c.GetText());
              value_write('Value',val,c, valueAccessor, allBindingsAccessor);
            }
            else
            {
              if(updatedelay>0)
              {
                c.binding_update_timer=setTimeout(function() {
                  clearTimeout(c.binding_update_timer);
                  c.binding_update_timer=null;
                  if(typeof c.GetText === 'function') {                  
                    var val=parse_text_value(valueAccessor,c.GetText());
                    value_write('Value',val,c, valueAccessor, allBindingsAccessor);
                  }                  
                },updatedelay);              
              }
            }
            return true;
          },'OnTextChanged');
          c.AddEvent(function(c) {
            if(c.binding_update_timer) {
              clearTimeout(c.binding_update_timer);
              c.binding_update_timer=null;
            }
            value_read('Value',c,valueAccessor,function(val) {
              if(typeof c.SetText === 'function')
                var et=format_edit_value(valueAccessor,val);
                if(typeof c.SetEditText === 'function') c.SetEditText(et);
                else c.SetText(et);              
            });
            return true;
          },'OnFocus');
          c.AddEvent(function(c) {
            if(c.binding_update_timer) clearTimeout(c.binding_update_timer);
            delete c.binding_update_timer;

            var val=parse_text_value(valueAccessor,c.GetText());
            if(value_write('Value',val,c, valueAccessor, allBindingsAccessor))
              value_update(c, valueAccessor);
            return true;
          },'OnBlur');
          break;
        case 'ngPages':
          c.AddEvent(function(c,op) {
            var p=c.Page;
            if((p>=0)&&(p<c.Pages.length))
            {
              var pg=c.Pages[p];
              if(ngVal(pg.id,'')!='') p=pg.id;
              if(value_write('Value',p,c, valueAccessor, allBindingsAccessor))
                value_update(c, valueAccessor);
            }
            return true;
          },'OnPageChanged');
          break;
        case 'ngButton':
        case 'ngSysAction':
          c.AddEvent(function(c) {
            if(value_write('Value',ng_toNumber(c.Checked),c, valueAccessor, allBindingsAccessor))
              value_update(c, valueAccessor);
            return true;
          },'OnCheckChanged');
          break;
        case 'ngSysURLParams':
          c.AddEvent('OnInitialized',function(c) {
            value_write('Value',c.Params,c, valueAccessor, allBindingsAccessor);
          });
          c.AddEvent('OnParamsChanged',function(c) {
            value_write('Value',c.Params,c, valueAccessor, allBindingsAccessor);
          });
          break;
        case 'ngSysViewModelSettings':
          function loadvmsettings(settings) {
            value_lock('Value',c,function() {
              var v=valueAccessor();
              if((v)&&(ko.isObservable(v))) props=v();
              else props=v;
              if(ng_typeObject(props)) {
                for(var i in props) {
                  props[i]=ko.ng_setvalue(props[i],settings.Get(i,ko.ng_getvalue(props[i])));
                }
                if((v)&&(ko.isWriteableObservable(v))) v(props);
              }
            });
          }
          if((c._settings)&&(c.Enabled)) loadvmsettings(c._settings);
          c.AddEvent('OnInitialized',function(c,settings) {
            loadvmsettings(settings);
          });
          c.AddEvent('OnSettingsLoaded',function(c,settings) {
            loadvmsettings(settings);
          });
          break;
        case 'ngProgressBar':
          c.AddEvent('SetPosition',function(p) {
            value_write('Value',p,c, valueAccessor, allBindingsAccessor);
            return true;
          });
          break;
        case 'ngWebBrowser':
          c.AddEvent('SetURL',function(p) {
            var txt=parse_text_value(valueAccessor,p);
            value_write('Value',txt,c, valueAccessor, allBindingsAccessor);
            return true;
          });
          break;
        case 'ngCalendar':
          c.AddEvent(function(c) {
            var val=c.GetSelected();
            if((c.SelectType==ngcalSelectSingle)&&(val.length==1)) val=val[0];
            if(value_write('Value',val,c, valueAccessor, allBindingsAccessor))
              value_update(c, valueAccessor);
            return true;
          },'OnSelectChanged');
          break;
      }
    };

    function value_update(c, valueAccessor, allBindingsAccessor) {

      if(c.CtrlType==='ngList')
      {
        if(c['binding_updatingValue']) {
          //console.log('updating ignore');
          var val=ko.ng_getvalue(valueAccessor()); // just read to subscribe observables
          return;
        }

        function compareListItems_update(a,b) {
          return compareListItems(a,b,bindinfo);
        }

        function synclistupdate(arr, parent) {
          //console.log('vmupdated',c);

          var items=[];
          for(var i=0;i<arr.length;i++)
            items[i]=vmGetListItem(c,arr[i]);

          c.BeginUpdate();
          try {
            synclistupdateex(items, parent);
          }
          finally {
            c.EndUpdate();
          }
        }

        function synclistupdateex(arr, parent)
        {
          var editScript=ng_GetArraysEditScript(parent.Items,arr,compareListItems_update);
          for (var i = 0, j = 0; i < editScript.length; i++) {
            switch (editScript[i].status) {
              case 0://"retained":
                //console.log('update retained',arr[j]);

                var it=parent.Items[j];
                var vmit=arr[j];

                c.need_update=true;

                if(it.Checked!==vmit.Checked) c.CheckItem(it,vmit.Checked);
                if(it.Collapsed!==vmit.Collapsed) {
                  if(vmit.Collapsed) c.Collapse(it);
                  else c.Expand(it);
                }

                var items=vmit.Items;
                if(ng_IsArrayVar(items))
                  synclistupdateex(items, it);
                else
                  c.Clear(it);
                j++;
                break;
              case 2://"deleted":
                //console.log('update deleted',j);
                var it=editScript[i].value;
                if((keyfield)&&(typeof selval!=='undefined')&&(ng_VarEquals(vmGetFieldValueByID(it,keyfield),selval)))
                {
                  e.ListItem = { };
                  vmSetFieldValueByID(e.ListItem,keyfield,selval);
                  e.SetText('');
                }
                c.Delete(j,parent);
                break;
              case 1://"added":
                var item=editScript[i].value;
                if(!ng_typeObject(item)) item={};

                //console.log('update added',item);
                c.Insert(j,item,parent);

                if((keyfield)&&(typeof selval!=='undefined')&&(ng_VarEquals(vmGetFieldValueByID(item,keyfield),selval)))
                  c.SelectDropDownItem(item);

                j++;
                break;
            }
          }
        }

        var bindinfo={};
        var e=c.DropDownOwner;
        if(e)
        {
          var selval;
          var keyfield=ngVal(e.LookupKeyField, 'Value');
          if(e.ListItem) selval=vmGetFieldValueByID(e.ListItem,keyfield);
        }
        var binding=allBindingsAccessor();
        bindinfo.KeyField  = binding["KeyField"];

        value_lock('Value',c,function() {

          c.need_vmupdate=false;
          if(c.binding_update_timer) clearTimeout(c.binding_update_timer);
          c.binding_update_timer=null;

          var checkedacc,selectedacc;
          if(c.DataBindings.Checked) {
            checkedacc=c.DataBindings.Checked.ValueAccessor();
            if((checkedacc)&&(typeof checkedacc.valueWillMutate === 'function')) checkedacc.valueWillMutate();
          }
          if(c.DataBindings.Selected) {
            selectedacc=c.DataBindings.Selected.ValueAccessor();
            if((selectedacc)&&(typeof selectedacc.valueWillMutate === 'function')) selectedacc.valueWillMutate();
          }

          var val=ko.ng_unwrapobservable(valueAccessor());
          if(ng_IsArrayVar(val))
          {
            synclistupdate(val, c);
          }
          else
          {
            c.BeginUpdate();
            c.Clear();
            c.EndUpdate();
            if((keyfield)&&(typeof selval!=='undefined'))
            {
              e.ListItem = { };
              vmSetFieldValueByID(e.ListItem,keyfield,selval);
              e.SetText('');
            }
          }

          if(checkedacc) {
            if(typeof checkedacc.valueHasMutated === 'function') checkedacc.valueHasMutated();
            else checkedacc(checkedacc());
          }
          if(selectedacc) {
            if(typeof selectedacc.valueHasMutated === 'function') selectedacc.valueHasMutated();
            else selectedacc(selectedacc());
          }
        });
        return;
      }

      value_read('Value',c,valueAccessor,function(val) {
        switch(c.CtrlType)
        {
          case 'ngButton':
          case 'ngSysAction':
            var v=ng_toNumber(val);
            if((isNaN(v))||((v!=0)&&(v!=1)&&(v!=2))) v=(ng_toBool(val) ? 1 : 0);
            c.Check(v);
            break;
          case 'ngSysTimer':
            var v=ng_toInteger(val,null);
            if((c.Interval!==v)&&(v!==null)) {
              c.Interval=v;
              if(c.IsStarted()) c.Restart();
            }
            break;
          case 'ngSysRPC':
            if(ng_typeObject(val)) {
              for(var i in val) {
                c.SetParam(i,val[i]);
              }
            }
            break;
          case 'ngSysURLParams':
            if(ng_typeObject(val)) c.SetValues(val);
            break;
          case 'ngSysViewModelSettings':
            c.SetValues(val);
            break;
          case 'ngPages':
            if((ng_IsArrayVar(val))&&(val.length==1)) val=val[0];
            c.SetPage(val);
            break;
          case 'ngWebBrowser':
            var txt=format_text_value(valueAccessor,val);
            c.SetURL(ng_formatWWW(txt,txt));
            break;
          case 'ngProgressBar':
            c.SetPosition(ng_toInteger(val,0));
            break;
          case 'ngCalendar':
            c.SetSelected(ng_toDate(val));
            break;
          default:
            if(typeof c.SetText === 'function')
              c.SetText(format_text_value(valueAccessor,val));
            break;
        }
      });
    };
    ngRegisterBindingHandler('Value',value_update,value_init);

    ngRegisterBindingHandler('Lookup',
      function (c, valueAccessor, allBindingsAccessor, viewModel) {
        if(c.CtrlType==='ngEdit')
        {
          value_read('Lookup',c,valueAccessor,function(val) {
            var list=c.DropDownControl;
            if(!list) return;
            var found=null;
            var keyfield=ngVal(c.LookupKeyField, 'Value');
            if(!ng_isEmpty(val))
            {
              list.Scan(function(list,it,parent,userdata) {
                if(ng_VarEquals(vmGetFieldValueByID(it,keyfield),val))
                {
                  found=it;
                  return false;
                }
                return true;
              });
            }
            if(!found)
            {
              c.ListItem = { };
              vmSetFieldValueByID(c.ListItem,keyfield,ng_CopyVar(val));
              c.SetText('');
            }
            else
            {
              list.SelectDropDownItem(found);
            }
          });
        }
      },
      function (c, valueAccessor, allBindingsAccessor, viewModel) {
        if(c.CtrlType==='ngEdit')
        {
          var undefined;
          c.LookupKeyField = ngVal(allBindingsAccessor()["KeyField"],'Value');
          c.AddEvent(function(e,l,it,oit) {
            var keyfield=ngVal(e.LookupKeyField, 'Value');
            var kfval=vmGetFieldValueByID(it,keyfield);
            if(!ng_isEmpty(kfval))
            {
              value_write('Lookup',ng_CopyVar(kfval),e, valueAccessor, allBindingsAccessor);
            }
            return true;
          },'OnListItemChanged');
          c.AddEvent(function(e,l) {
            var obval=valueAccessor();
            if((obval)&&(typeof obval.FieldDef !== 'undefined')&&(ngVal(obval.FieldDef.ReadOnly,false))) return false;

            var keyfield=ngVal(e.LookupKeyField, 'Value');
            var list=e.DropDownControl;
            var selval=(e.ListItem ? vmGetFieldValueByID(e.ListItem,keyfield) : undefined);
            if(!ng_isEmpty(selval))
            {
              list.Scan(function(list,it,parent,userdata) {
                if(ng_VarEquals(vmGetFieldValueByID(it,keyfield),selval))
                {
                  list.SelectDropDownItem(it);
                  return false;
                }
                return true;
              });
            }
            return true;
          },'OnDropDown');
        }
      }
    );

    ngRegisterBindingHandler('Selected',
      function (c, valueAccessor, allBindingsAccessor, viewModel) {
        if(c.CtrlType==='ngList')
        {
          value_read('Selected',c,valueAccessor,function(val) {
            var keyfield=ngVal(c.SelectKeyField, 'Value');
            c.selected=new Array();
            if(!ng_isEmpty(val))
            {
              if(!ng_typeArray(val))
              {
                var a=new Array();
                a.push(val);
                val=a;
              }
              c.Scan(function(c,it,parent,userdata) {
                for(var j=0;j<val.length;j++)
                {
                  if(ng_VarEquals(vmGetFieldValueByID(it,keyfield),val[j]))
                  {
                    var id=c.ItemId(it);
                    if(id!='')
                    {
                      c.last_selected=id;
                      c.selected[id]=true;
                    }
                    break;
                  }
                }
                return true;
              });
            }
            c.SelectChanged();
          });
        }
      },
      function (c, valueAccessor, allBindingsAccessor, viewModel) {
        if(c.CtrlType==='ngList')
        {
          c.SelectKeyField = ngVal(allBindingsAccessor()["KeyField"],'Value');
          c.AddEvent(function(list) {
            value_lock('Selected',c,function() {
              var keyfield=ngVal(c.SelectKeyField, 'Value');
              var selected=list.GetSelected();
              var val=new Array();
              var s,sval;
              for(var i in selected)
              {
                s=selected[i];
                sval=vmGetFieldValueByID(s,keyfield);
                if(sval != 'undefined') val.push(ng_CopyVar(sval));
              }
              value_write_ex(val, valueAccessor, allBindingsAccessor);
            });
            return true;
          },'OnSelectChanged');
        }
      }
    );

    ngRegisterBindingHandler('Checked',
      function (c, valueAccessor, allBindingsAccessor, viewModel) {
        value_read('Checked',c,valueAccessor,function(val) {
          switch(c.CtrlType)
          {
            case 'ngButton':
            case 'ngSysAction':
              var v=ng_toNumber(val);
              if((isNaN(v))||((v!=0)&&(v!=1)&&(v!=2))) v=(ng_toBool(val) ? 1 : 0);
              c.Check(v);
              break;
            case 'ngList':
              var keyfield=ngVal(c.CheckedKeyField, 'Value');
              if(!ng_isEmpty(val)&&(!ng_typeArray(val)))
              {
                var a=new Array();
                a.push(val);
                val=a;
              }
              c.BeginUpdate();
              try {
                c.Scan(function(c,it,parent,userdata) {
                  var check=0;
                  if(!ng_isEmpty(val))
                    for(var j=0;j<val.length;j++)
                      if(ng_VarEquals(vmGetFieldValueByID(it,keyfield),val[j]))
                      {
                        check=1;
                        break;
                      }
                  c.CheckItem(it,check);
                  return true;
                });
              } finally {
                c.EndUpdate();
              }
              break;
          }
        });
      },
      function (c, valueAccessor, allBindingsAccessor, viewModel) {
        switch(c.CtrlType)
        {
          case 'ngButton':
          case 'ngSysAction':
            c.AddEvent(function(c) {
              value_write('Checked',ng_toNumber(c.Checked),c, valueAccessor, allBindingsAccessor);
              return true;
            },'OnCheckChanged');
            break;
          case 'ngList':
            c.CheckedKeyField = ngVal(allBindingsAccessor()["KeyField"],'Value');
            c.AddEvent(function(list) {
              value_lock('Checked',c,function() {
                var keyfield=ngVal(c.CheckedKeyField, 'Value');
                var val=new Array();
                c.Scan(function(c,it,parent,userdata) {
                  if(ngVal(it.Checked,0))
                  {
                    var sval=vmGetFieldValueByID(it,keyfield);
                    if(typeof sval!=='undefined') val.push(ng_CopyVar(sval));
                  }
                  return true;
                });
                value_write_ex(val,valueAccessor, allBindingsAccessor);
              });
              return true;
            },'OnCheckChanged');
            break;
        }
      }
    );

    ngRegisterBindingHandler('Command',null,
      function (c, valueAccessor, allBindingsAccessor, viewModel) {
        var valuenames = allBindingsAccessor()["ValueNames"];
        var cmd = ''+valueAccessor();
        if(cmd=='') return;
        switch(c.CtrlType)
        {
          case 'ngButton':
          case 'ngSysAction':
            var undefined;
            c.AddEvent('OnClick', function(e) {
              if((viewModel.Owner)&&(viewModel.Owner.Command))
                viewModel.Owner.Command(cmd, (valuenames ? { ValueNames: valuenames } : undefined));
              return true;
            });
            c.Update();
            break;
          case 'ngSysTimer':
            c.AddEvent('OnTimer', function(c) {
              if((viewModel.Owner)&&(viewModel.Owner.Command))
                viewModel.Owner.Command(cmd, (valuenames ? { ValueNames: valuenames } : undefined));
              return true;
            });
            break;
        }
      }
    );

    function error_binding(c,valueAccessor,focus)
    {
      var txt=ng_toString(ko.utils.unwrapObservable(valueAccessor()));

      var f=c.ParentControl;
      while(f)
      {
        if(f.CtrlInheritsFrom('ngViewModelForm'))
        {
          f.ShowControlError(c,txt,focus);
          return;
        }
        f=f.ParentControl;
      }
      if((txt===false)||(txt===null)) txt='';
      c.ErrorMessage=txt;
      var err=(txt!=='');
      if(typeof c.SetErrorState === 'function') c.SetErrorState(err);
      else
        if(typeof c.SetInvalid === 'function') c.SetInvalid(err);
    }

    ngRegisterBindingHandler('Error', function (c, valueAccessor) {
      error_binding(c,valueAccessor,false);
    });

    ngRegisterBindingHandler('ShowError', function (c, valueAccessor) {
      error_binding(c,valueAccessor,true);
    });

    ngRegisterBindingHandler('Link',null,null);
  }
};
