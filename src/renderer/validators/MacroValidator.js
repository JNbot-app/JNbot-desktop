function MacroInfoValidator(name, description) {
  if (!name?.length) return { name: 'Name is required' };
  else if (name.length > 32)
    return { name: 'Name must be less than 32 characters' };
  else if (name.match(/[^a-zA-Z0-9_ -]/g))
    return { name: 'Name cannot contain special characters' };
  else if (description?.length > 100)
    return {
      description: 'Description must be less than 100 characters',
    };
  return null;
}

function uploadValidation(components) {
  if (components.length < 3) return 'Plugin must have at least 3 components';
  if (components.length > 2000)
    return 'Plugin cannot have more than 2000 components';
  if (components.find((c) => c.type === 506))
    return 'Plugin cannot contain the discord message component';
  if (!components.find((c) => c.type === 0))
    return 'Plugin must contain the start plugin component';

  return null;
}

export { MacroInfoValidator, uploadValidation };
