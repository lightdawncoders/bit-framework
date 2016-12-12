﻿using Foundation.Api.ApiControllers;
using Foundation.Api.Middlewares.WebApi.OData.Contracts;
using Foundation.Model.Contracts;
using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Threading.Tasks;
using System.Web.Http.Controllers;
using System.Web.OData.Builder;

namespace Foundation.Api.Middlewares.WebApi.OData.Implementations
{
    public class DefaultAutoEdmBuilder : IAutoEdmBuilder
    {
        private MethodInfo _buildControllerOperations = null;
        private MethodInfo _buildDto = null;
        private MethodInfo _collectionParamterMethodInfo = null;

        public DefaultAutoEdmBuilder()
        {
            _buildControllerOperations = GetType().GetTypeInfo().GetMethod(nameof(BuildControllerOperations), BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.DeclaredOnly);

            _buildDto = GetType().GetTypeInfo().GetMethod(nameof(BuildDto), BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.DeclaredOnly);

            _collectionParamterMethodInfo = typeof(ActionConfiguration).GetTypeInfo().GetMethod(nameof(ActionConfiguration.CollectionParameter));
        }

        public virtual void AutoBuildEdmFromAssembly(Assembly assembly, ODataModelBuilder modelBuilder)
        {
            List<TypeInfo> controllers = assembly
                .GetTypes()
                .Select(t => t.GetTypeInfo())
                .Where(t =>
                {
                    TypeInfo baseGenericType = (t.BaseType?.GetTypeInfo()?.IsGenericType == true ? t.BaseType?.GetTypeInfo()?.GetGenericTypeDefinition() : null)?.GetTypeInfo();

                    while (baseGenericType != null)
                    {
                        if (typeof(DtoController<>).GetTypeInfo().IsAssignableFrom(baseGenericType))
                            return true;

                        baseGenericType = (baseGenericType.BaseType?.GetTypeInfo()?.IsGenericType == true ? baseGenericType.BaseType?.GetTypeInfo()?.GetGenericTypeDefinition() : null)?.GetTypeInfo();
                    }

                    return false;
                })
                .ToList();

            AutoBuildEdmFromTypes(controllers, modelBuilder);
        }

        public virtual void AutoBuildEdmFromTypes(IEnumerable<TypeInfo> controllers, ODataModelBuilder modelBuilder)
        {
            var controllersWithDto = controllers
                .Select(c => new
                {
                    DtoType = GetFinalDtoType(c.BaseType.GetGenericArguments().SingleOrDefault(t => IsDto(t.GetTypeInfo())).GetTypeInfo()),
                    Controller = c
                })
                .Where(c => c.DtoType != null)
                .ToList();

            foreach (var controllerWithDto in controllersWithDto)
            {
                _buildDto.MakeGenericMethod(controllerWithDto.DtoType).Invoke(this, new object[] { modelBuilder, controllerWithDto.Controller });
            }

            foreach (var controllerWithDto in controllersWithDto)
            {
                if (controllerWithDto.Controller.IsGenericType)
                    continue;
                _buildControllerOperations.MakeGenericMethod(controllerWithDto.DtoType).Invoke(this, new object[] { modelBuilder, controllerWithDto.Controller });
            }
        }

        private void BuildDto<TDto>(ODataModelBuilder modelBuilder, TypeInfo apiController)
             where TDto : class
        {
            TypeInfo dtoType = typeof(TDto).GetTypeInfo();
            string controllerName = GetControllerName(apiController);
            EntitySetConfiguration<TDto> entitySet = modelBuilder.EntitySet<TDto>(controllerName);
            if (GetBaseType(dtoType) == null)
                entitySet.EntityType.DerivesFromNothing();
        }

        private void BuildControllerOperations<TDto>(ODataModelBuilder modelBuilder, TypeInfo apiController)
            where TDto : class
        {
            TypeInfo dtoType = typeof(TDto).GetTypeInfo();
            string controllerName = GetControllerName(apiController);
            EntitySetConfiguration<TDto> entitySet = modelBuilder.EntitySet<TDto>(controllerName);

            foreach (MethodInfo method in apiController.GetMethods(BindingFlags.Instance | BindingFlags.Public | BindingFlags.DeclaredOnly))
            {
                IActionHttpMethodProvider actionHttpMethodProvider =
                    method.GetCustomAttributes().OfType<FunctionAttribute>().Cast<IActionHttpMethodProvider>()
                    .Union(method.GetCustomAttributes().OfType<ActionAttribute>().Cast<IActionHttpMethodProvider>())
                    .SingleOrDefault();

                if (actionHttpMethodProvider != null)
                {
                    bool isFunction = actionHttpMethodProvider is FunctionAttribute;
                    bool isAction = actionHttpMethodProvider is ActionAttribute;

                    if (!isFunction && !isAction)
                        continue;

                    List<ParameterAttribute> actionParameters =
                        method.GetCustomAttributes<ParameterAttribute>().ToList();

                    OperationConfiguration operationConfiguration = null;

                    if (isAction)
                        operationConfiguration = entitySet.EntityType.Collection.Action(method.Name);
                    else if (isFunction)
                        operationConfiguration = entitySet.EntityType.Collection.Function(method.Name);

                    foreach (ParameterAttribute actionParameter in actionParameters)
                    {
                        if (actionParameter.Type.GetTypeInfo() != typeof(string).GetTypeInfo() &&
                            typeof(IEnumerable).GetTypeInfo().IsAssignableFrom(actionParameter.Type.GetTypeInfo()))
                        {
                            TypeInfo parameterType = actionParameter.Type.GetTypeInfo();

                            if (parameterType.IsArray)
                                throw new InvalidOperationException($"Use IEnumerable<{parameterType.GetElementType().GetTypeInfo().Name}> instead of {parameterType.GetElementType().GetTypeInfo().Name}[] for parameter {actionParameter.Name} of {actionParameter.Name} in {controllerName} controller");

                            if (parameterType.IsGenericType)
                                parameterType = parameterType.GetGenericArguments().Single().GetTypeInfo();

                            ParameterConfiguration parameter = (ParameterConfiguration)_collectionParamterMethodInfo
                                                                                            .MakeGenericMethod(parameterType)
                                                                                            .Invoke(operationConfiguration, new object[] { actionParameter.Name });

                            parameter.OptionalParameter = actionParameter.IsOptional;
                        }
                        else
                        {
                            operationConfiguration.Parameter(actionParameter.Type, actionParameter.Name)
                                .OptionalParameter =
                                actionParameter.IsOptional;
                        }
                    }

                    TypeInfo type = method.ReturnType.GetTypeInfo();

                    if (type.Name != "Void" && type.Name != typeof(Task).GetTypeInfo().Name)
                    {
                        operationConfiguration.OptionalReturn = false;

                        bool isCollection = false;

                        if (typeof(Task).GetTypeInfo().IsAssignableFrom(type))
                        {
                            if (type.IsGenericType)
                                type = type.GetGenericArguments().Single().GetTypeInfo();
                        }

                        if (typeof(string) != type && typeof(IEnumerable).IsAssignableFrom(type))
                        {
                            if (type.IsGenericType)
                                type = type.GetGenericArguments().Single().GetTypeInfo();
                            else if (type.IsArray)
                                type = type.GetElementType().GetTypeInfo();
                            isCollection = true;
                        }

                        if (IsDto(type))
                        {
                            type = GetFinalDtoType(type);

                            if (isCollection == true)
                            {
                                if (isAction)
                                    ((ActionConfiguration)operationConfiguration).ReturnsCollectionFromEntitySet<TDto>(controllerName);
                                else
                                    ((FunctionConfiguration)operationConfiguration).ReturnsCollectionFromEntitySet<TDto>(controllerName);
                            }
                            else
                            {
                                if (isAction)
                                    ((ActionConfiguration)operationConfiguration).ReturnsFromEntitySet<TDto>(controllerName);
                                else if (isFunction)
                                    ((FunctionConfiguration)operationConfiguration).ReturnsFromEntitySet<TDto>(controllerName);
                            }
                        }
                        else
                        {
                            if (isCollection == false)
                            {
                                if (isAction)
                                    ((ActionConfiguration)operationConfiguration).Returns(type);
                                else if (isFunction)
                                    ((FunctionConfiguration)operationConfiguration).Returns(type);
                            }
                            else
                            {
                                operationConfiguration.GetType()
                                    .GetTypeInfo()
                                    .GetMethod("ReturnsCollection")
                                    .MakeGenericMethod(type)
                                    .Invoke(operationConfiguration, new object[] { });
                            }
                        }
                    }
                    else
                    {
                        if (isFunction)
                            throw new InvalidOperationException("Function must have a return type, use action instead");

                        operationConfiguration.OptionalReturn = true;
                    }
                }
            }
        }

        public virtual bool IsDto(TypeInfo type)
        {
            return type.IsClass && type.GetInterface(nameof(IDto)) != null;
        }

        public virtual TypeInfo GetFinalDtoType(TypeInfo type)
        {
            if (type.IsGenericParameter && type.GetGenericParameterConstraints().Any())
            {
                Type finalDtoType = type.GetGenericParameterConstraints().SingleOrDefault(t => IsDto(t.GetTypeInfo()));
                if (finalDtoType != null)
                    return finalDtoType.GetTypeInfo();
                return null;
            }
            else
                return type;
        }

        public virtual TypeInfo GetBaseType(TypeInfo dtoType)
        {
            if (dtoType == null)
                throw new ArgumentNullException(nameof(dtoType));

            if (IsDto(dtoType.BaseType.GetTypeInfo()))
                return dtoType.BaseType.GetTypeInfo();
            else
                return null;
        }

        public virtual string GetControllerName(TypeInfo type)
        {
            string name = type.Name;
            int index = name.IndexOf('`');
            return (index == -1 ? name : name.Substring(0, index)).Replace("Controller", string.Empty);
        }
    }
}
